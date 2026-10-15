import { ESPLoader, Transport, type IEspLoaderTerminal } from 'esptool-js';
import SparkMD5 from 'spark-md5';
import { APP_DESC_READ_SIZE, readAppDescription, type AppDescription } from './app-image';
import { deviceNameFromMac } from './device';
import { RECORD_SIZE, decodeFactoryRecord, type FactoryRecord } from './factory-record';
import {
  PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE, findApp, findFactoryConfig, parsePartitionTable, type Partition,
} from './partition-table';
import type { FlashWrite } from './plan';

/* The USB link to a patch, over Web Serial (Chrome, Edge). esptool-js puts the ESP32
   in its ROM bootloader, loads Espressif's flasher stub and reads/writes flash. */

export const serialSupported = (): boolean => typeof navigator !== 'undefined' && 'serial' in navigator;

export interface PatchInfo {
  chip: string;
  mac: string;
  /** The Bluetooth name it advertises, e.g. WearWise-6280. */
  name: string;
  /** null: no partition table (a blank or foreign board). */
  layout: Partition[] | null;
  /** null: no label PIN (never set up, or flashed with older firmware). */
  record: FactoryRecord | null;
  app: AppDescription | null;
}

/* 460800 is idf.py's default: fast, and reliable on most CP210x and CH340 bridges.
   Some boards or cables corrupt data above 115200 (seen on a real patch: every read at
   230400 and 460800 failed its checksum), so a write that breaks is retried at 115200. */
const BAUD = 460800;
const SAFE_BAUD = 115200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A transfer that broke on the wire (as opposed to a refusal or a missing chip). */
export const isLinkError = (e: unknown): boolean =>
  /data stream stopped|serial noise|corruption|timed? ?out|md5/i.test(e instanceof Error ? e.message : String(e));

async function connect(port: SerialPort, baudrate: number, log: (line: string) => void): Promise<{ loader: ESPLoader; transport: Transport }> {
  const transport = new Transport(port, false);
  const terminal: IEspLoaderTerminal = { clean: () => {}, writeLine: log, write: log };
  const loader = new ESPLoader({ transport, baudrate, romBaudrate: SAFE_BAUD, terminal });
  try {
    await loader.main();
    if (loader.chip.CHIP_NAME !== 'ESP32') {
      throw new Error(`This board is an ${loader.chip.CHIP_NAME}. WearWise patches use an ESP32.`);
    }
  } catch (e) {
    await transport.disconnect().catch(() => {});
    throw e;
  }
  return { loader, transport };
}

export class PatchLink {
  private constructor(
    private readonly port: SerialPort,
    private loader: ESPLoader,
    private transport: Transport,
    private baud: number,
    private readonly log: (line: string) => void,
  ) {}

  /** Asks the browser for a port (it shows its picker), then connects to the chip. */
  static async open(log: (line: string) => void): Promise<PatchLink> {
    const port = await navigator.serial.requestPort();
    const { loader, transport } = await connect(port, BAUD, log);
    return new PatchLink(port, loader, transport, BAUD, log);
  }

  /** Reconnects at the slow, safe speed (the chip restarts into its bootloader). */
  private async slowDown(): Promise<void> {
    await this.transport.disconnect().catch(() => {});
    await sleep(300);
    const { loader, transport } = await connect(this.port, SAFE_BAUD, this.log);
    this.loader = loader;
    this.transport = transport;
    this.baud = SAFE_BAUD;
  }

  async readInfo(): Promise<PatchInfo> {
    const chip = await this.loader.chip.getChipDescription(this.loader);
    const mac = await this.loader.chip.readMac(this.loader);
    const table = parsePartitionTable(await this.read(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE));
    const layout = table.length ? table : null;
    const cfg = layout && findFactoryConfig(layout);
    const app = layout && findApp(layout);
    return {
      chip,
      mac,
      name: deviceNameFromMac(mac),
      layout,
      record: cfg ? decodeFactoryRecord(await this.read(cfg.offset, RECORD_SIZE)) : null,
      app: app ? readAppDescription(await this.read(app.offset, APP_DESC_READ_SIZE)) : null,
    };
  }

  /** Writes and verifies every region (MD5 computed on the chip), reporting 0..1. If the
      link breaks at full speed, it reconnects at 115200 and writes everything again. */
  async write(writes: FlashWrite[], onProgress: (fraction: number, what: string) => void): Promise<void> {
    try {
      await this.writeOnce(writes, onProgress);
    } catch (e) {
      if (this.baud === SAFE_BAUD || !isLinkError(e)) throw e;
      this.log('The USB link dropped data at full speed. Reconnecting at 115200 baud and writing again; this takes a few minutes.');
      onProgress(0, 'Retrying more slowly');
      await this.slowDown();
      await this.writeOnce(writes, onProgress);
    }
  }

  private async writeOnce(writes: FlashWrite[], onProgress: (fraction: number, what: string) => void): Promise<void> {
    const total = writes.reduce((n, w) => n + w.data.length, 0);
    const before = writes.map((_, i) => writes.slice(0, i).reduce((n, w) => n + w.data.length, 0));
    await this.loader.writeFlash({
      fileArray: writes.map((w) => ({ address: w.address, data: w.data })),
      flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (i, written, size) => {
        const w = writes[i]!;
        onProgress((before[i]! + (size ? (written / size) * w.data.length : 0)) / total, w.what);
      },
      calculateMD5Hash: (image) => SparkMD5.ArrayBuffer.hash(image.slice().buffer),
    });
    onProgress(1, '');
  }

  /** Erases the whole flash (firmware, label PIN, settings) and checks the layout and
   *  label areas read back blank. A chip erase takes 10–30 s; there is no progress. */
  async eraseAll(): Promise<void> {
    await this.loader.eraseFlash();
    for (const at of [PARTITION_TABLE_OFFSET, 0x3ff000]) {
      if (!(await this.read(at, 32)).every((b) => b === 0xff)) throw new Error('The patch still has data after erasing. Try again.');
    }
  }

  /** Reads the label back from flash: proof the PIN on screen is the PIN on the patch. */
  async readRecord(layout: Partition[]): Promise<FactoryRecord | null> {
    const cfg = findFactoryConfig(layout);
    return cfg ? decodeFactoryRecord(await this.read(cfg.offset, RECORD_SIZE)) : null;
  }

  /** Reboots into the firmware and releases the port. */
  async restartAndClose(): Promise<void> {
    try {
      /* EN low then high with IO0 high: a normal boot (esptool's hard reset). */
      await this.transport.setDTR(false);
      await this.transport.setRTS(true);
      await sleep(100);
      await this.transport.setRTS(false);
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    await this.transport.disconnect().catch(() => {});
  }

  /* esptool-js's readFlash returns the data but leaves the stub's closing MD5 frame
     unread. The next command then reaches the stub while it is still finishing that
     read, and is lost: every second read timed out ("Serial data stream stopped").
     esptool.py reads and checks the frame before going on, and so does this, which
     also verifies every read. Relies on esptool-js 0.7.0's behaviour (pinned). */
  private async read(address: number, size: number): Promise<Uint8Array> {
    const data = (await this.loader.readFlash(address, size)).slice(0, size);
    const digest = await this.transport.read(1000);
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (digest.length !== 16 || hex !== SparkMD5.ArrayBuffer.hash(data.slice().buffer)) {
      throw new Error('Reading from the patch didn’t verify. Try again; if it keeps happening, use another USB cable.');
    }
    return data;
  }
}

/** Plain-language versions of what goes wrong at the USB end. */
export function describeSerialError(e: unknown): string | null {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotFoundError') return null; // the picker was closed without choosing: not an error
  if (name === 'NetworkError' || /failed to open serial port/i.test(msg)) {
    return 'The USB port is busy. Close any other program using it (Arduino IDE, idf.py monitor, another tab) and try again.';
  }
  if (name === 'InvalidStateError' || /already open/i.test(msg)) {
    return 'The USB port is still open from an earlier connection. Unplug the patch, plug it back in and connect again.';
  }
  if (/data stream stopped|serial noise|corruption/i.test(msg)) {
    return 'The USB connection kept dropping data, even at the slowest speed. Try a shorter USB cable, or plug the patch straight into the computer instead of a hub, then connect again.';
  }
  if (/failed to connect|timed out|wrong boot mode|no serial data/i.test(msg)) {
    return 'The patch didn’t answer. Hold its BOOT button, press and release EN (or RST), let go of BOOT, then connect again. A charge-only USB cable also causes this.';
  }
  if (/md5/i.test(msg)) return 'The written data didn’t verify. Use a shorter or better USB cable and try again.';
  return msg;
}
