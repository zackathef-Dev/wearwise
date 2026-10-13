import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { HoldButton } from '../components/HoldButton';
import { Icon } from '../components/Icon';
import { Alert, Badge, Button, ErrorState, LoadingState } from '../components/ui';
import { useAsync, type AsyncState } from '../components/useAsync';
import { formatDate } from '../data/format';
import type { FactoryRecord } from '../patch/factory-record';
import { forPatch, loadBundledFirmware, sha256Hex, type Firmware } from '../patch/firmware';
import { firmwareFromFiles } from '../patch/firmware-files';
import { findFactoryConfig, sameLayout } from '../patch/partition-table';
import { formatPin, generatePin } from '../patch/pin';
import { planWrites, type PatchAction } from '../patch/plan';
import { PatchLink, describeSerialError, serialSupported, type PatchInfo } from '../patch/serial-link';

/* Patch setup: install firmware on a WearWise patch over USB and give it the
   Bluetooth PIN printed on its label. Everything happens between this browser tab
   and the USB port; nothing is sent to the server. */

type Stage =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'ready'; info: PatchInfo; notice?: string }
  /** progress < 0: no measure of progress (a chip erase). */
  | { kind: 'working'; info: PatchInfo; action: PatchAction | 'erase'; progress: number; step: string }
  | { kind: 'done'; info: PatchInfo; action: PatchAction; record: FactoryRecord | null; version: string | null }
  | { kind: 'error'; message: string };

const NO_FIRMWARE = 'No firmware chosen. Choose a firmware file above.';
const OLD_LAYOUT = 'This patch needs “Set up as a new patch” once first.';
const EMPTY = 'This patch is empty. Use “Set up as a new patch”.';
const NEW_LAYOUT = 'This firmware can only be installed with “Set up as a new patch”.';
const NO_PIN_SLOT = 'This firmware is too old to keep a label PIN. Choose current WearWise firmware.';

function blockers(info: PatchInfo, fw: Firmware | null | undefined): Record<PatchAction, string | null> {
  const target = fw && forPatch(fw, info.layout);
  const hasSlot = !!info.layout && !!findFactoryConfig(info.layout);
  const noSlot = info.layout ? OLD_LAYOUT : EMPTY;
  return {
    'set-up': !target ? NO_FIRMWARE : typeof target === 'string' ? target : findFactoryConfig(target.layout) ? null : NO_PIN_SLOT,
    update: !info.layout ? EMPTY : !target ? NO_FIRMWARE : typeof target === 'string' ? target
      : !hasSlot ? OLD_LAYOUT : !sameLayout(info.layout, target.layout) ? NEW_LAYOUT : null,
    'new-pin': hasSlot ? null : noSlot,
  };
}

export function PatchSetupPage() {
  const firmware = useAsync(() => loadBundledFirmware(), []);
  const link = useRef<PatchLink | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [confirming, setConfirming] = useState<PatchAction | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  /* Firmware chosen from files; null = the bundled build. */
  const [picked, setPicked] = useState<Firmware | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  /* SHA-256 of the chosen file's app image, shown before installing it. */
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const supported = serialSupported();
  const fw = picked ?? firmware.data;
  const busy = stage.kind === 'connecting' || stage.kind === 'working';

  /* Leaving the page boots the patch back into its firmware and frees the port. */
  useEffect(() => () => {
    void link.current?.restartAndClose();
    link.current = null;
  }, []);

  const appendLog = (line: string) => setLog((l) => [...l.slice(-400), line]);

  /* Every way out of a connection (Disconnect, Cancel, an error) boots the patch back
     into its firmware: left in its download mode it would stay silent — no Bluetooth —
     until it is unplugged. */
  const release = async () => {
    const l = link.current;
    link.current = null;
    await l?.restartAndClose().catch(() => undefined);
  };

  const fail = async (e: unknown) => {
    const message = describeSerialError(e);
    if (e instanceof Error) appendLog(`${e.name}: ${e.message}`);
    if (!message) setHint('No port was chosen. If the list was empty, check the patch is plugged in with a data cable and its USB driver is installed.');
    await release();
    setStage(message ? { kind: 'error', message } : { kind: 'idle' });
  };

  /* Set when Cancel is pressed while connecting: the connection, if it arrives, is let go. */
  const cancelled = useRef(false);

  const connect = async () => {
    setLog([]);
    setHint(null);
    cancelled.current = false;
    setStage({ kind: 'connecting' });
    try {
      link.current = await PatchLink.open(appendLog);
      const info = await link.current.readInfo();
      if (cancelled.current) { await release(); return; }
      setStage({ kind: 'ready', info });
    } catch (e) {
      if (cancelled.current) { await release(); return; }
      await fail(e);
    }
  };

  const cancelConnect = async () => {
    cancelled.current = true;
    setStage({ kind: 'idle' });
    await release();
  };

  const disconnect = async () => {
    setStage({ kind: 'idle' });
    await release();
  };

  const run = async (action: PatchAction) => {
    setConfirming(null);
    if (stage.kind !== 'ready' || !link.current) return;
    const { info } = stage;
    const record = action === 'update' ? undefined : { pin: generatePin(info.record?.pin), provisionedAt: new Date() };
    const target = fw ? forPatch(fw, info.layout) : null;
    try {
      if (typeof target === 'string') throw new Error(target);
      const writes = planWrites({ action, firmware: target ?? undefined, deviceLayout: info.layout, record });
      setStage({ kind: 'working', info, action, progress: 0, step: writes[0]?.what ?? '' });
      await link.current.write(writes, (progress, step) =>
        setStage((s) => (s.kind === 'working' ? { ...s, progress, step: step || s.step } : s)));
      /* Read the label back: what's printed must be what the patch will use. */
      const written = await link.current.readRecord(action === 'new-pin' ? info.layout! : target!.layout);
      if (record && written?.pin !== record.pin) throw new Error('The PIN read back from the patch doesn’t match. Run it again.');
      await link.current.restartAndClose();
      link.current = null;
      const version = action === 'new-pin' ? (info.app?.version ?? null) : fw!.version;
      setStage({ kind: 'done', info, action, record: written, version });
    } catch (e) {
      await fail(e);
    }
  };

  /* Held, not confirmed: see HoldButton. Stays connected so the empty patch can be
     set up straight away. */
  const erase = async () => {
    if (stage.kind !== 'ready' || !link.current) return;
    const { info } = stage;
    setStage({ kind: 'working', info, action: 'erase', progress: -1, step: 'Erasing the whole flash' });
    try {
      await link.current.eraseAll();
      setStage({
        kind: 'ready', info: await link.current.readInfo(),
        notice: `${info.name} is empty: no firmware, PIN, paired phones or Wi-Fi. Set it up to use it again.`,
      });
    } catch (e) {
      await fail(e);
    }
  };

  const ask = (action: PatchAction) => {
    if (stage.kind !== 'ready') return;
    /* A blank board has nothing to lose, and an update keeps everything; the rest asks
       first, and so does anything that isn't WearWise firmware. */
    const safe = action === 'update' || (action === 'set-up' && !stage.info.layout);
    /* Firmware from a file always asks first: nothing proves where a file came from. */
    if (safe && !isForeign(fw) && fw?.source !== 'files') void run(action);
    else setConfirming(action);
  };

  const pickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // choosing the same files again still fires
    if (!files.length) return;
    try {
      const chosen = firmwareFromFiles(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
      const app = chosen.parts.find((p) => p.role === 'app');
      setFingerprint(app ? await sha256Hex(app.data) : null);
      setPicked(chosen);
      setPickError(null);
    } catch (err) {
      setPickError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="titles">
          <h1>Patch setup</h1>
          <p className="muted">
            Install firmware on a WearWise patch over USB and give it the Bluetooth PIN printed on its label.
            The participant types that PIN when they pair the patch with their phone.
          </p>
        </div>
      </div>

      <div className="stack">
        {!supported && (
          <Alert kind="warning" title="This page needs Chrome or Edge on a computer">
            Safari and Firefox can’t talk to USB devices from a web page. Open this page in Google Chrome or Microsoft Edge.
          </Alert>
        )}
        <FirmwareSource
          bundled={firmware} picked={picked} error={pickError} disabled={busy}
          onFiles={(e) => void pickFiles(e)} onUseBundled={() => { setPicked(null); setPickError(null); setFingerprint(null); }}
        />

        <div className="card">
          {stage.kind === 'idle' && (
            <div className="patch-step">
              <ol className="patch-howto">
                <li>Plug the patch into this computer with a USB <strong>data</strong> cable. Plug in <strong>one patch at a time</strong>: Chrome lists identical patches under the same name.</li>
                <li>Click <strong>Connect patch</strong> and choose its port: usually “CP210x”, “USB Serial” or “USB-SERIAL CH340”.</li>
                <li>No port listed? Install the USB driver for the patch’s chip (Silicon Labs CP210x or WCH CH340), then try again.</li>
              </ol>
              <Button variant="primary" icon="usb" onClick={() => void connect()} disabled={!supported}>Connect patch</Button>
              {hint && <p className="small muted" role="status">{hint}</p>}
            </div>
          )}

          {stage.kind === 'connecting' && (
            <div className="patch-step">
              <LoadingState label="Connecting to the patch…" />
              <div className="row"><Button icon="x" onClick={() => void cancelConnect()}>Cancel</Button></div>
            </div>
          )}

          {stage.kind === 'ready' && (
            <ReadyView
              info={stage.info} notice={stage.notice} fw={fw} blocked={blockers(stage.info, fw)}
              onAction={ask} onErase={() => void erase()} onDisconnect={() => void disconnect()}
            />
          )}

          {stage.kind === 'working' && (
            <div className="patch-step" aria-live="polite">
              <h2>{WORKING[stage.action]} {stage.info.name}…</h2>
              {stage.progress < 0 ? (
                <>
                  <div className="progress indeterminate" role="progressbar" aria-label="Progress"><span /></div>
                  <p className="muted">{stage.step}. Keep the patch plugged in; this takes 10 to 30 seconds.</p>
                </>
              ) : (
                <>
                  <div
                    className="progress" role="progressbar" aria-label="Progress"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.progress * 100)}
                  >
                    <span style={{ width: `${Math.max(2, stage.progress * 100)}%` }} />
                  </div>
                  <p className="muted">{stage.step} · {Math.round(stage.progress * 100)}%. Keep the patch plugged in; this takes under a minute.</p>
                </>
              )}
            </div>
          )}

          {stage.kind === 'done' && (
            <div className="patch-step">
              <Alert kind="success" title={`${stage.info.name} is ready`}>
                {stage.action === 'update'
                  ? `Firmware ${stage.version ?? ''} is installed. The PIN, paired phones and Wi-Fi are unchanged.`
                  : 'It has a new PIN and no paired phones. Print the label and stick it on the patch.'}
              </Alert>
              {stage.record ? (
                <>
                  <PatchLabel name={stage.info.name} record={stage.record} version={stage.version} />
                  <p className="muted small">
                    To pair: in the WearWise app choose <strong>Pair a device</strong>, pick {stage.info.name} and type this
                    PIN when the phone asks for it.
                  </p>
                </>
              ) : (
                <p className="muted">This patch has no label PIN, so it uses a PIN it made up itself. Use “New PIN” to give it one.</p>
              )}
              <div className="row">
                {stage.record && <Button icon="printer" onClick={() => window.print()}>Print label</Button>}
                <Button variant="primary" icon="usb" onClick={() => setStage({ kind: 'idle' })}>Set up another patch</Button>
              </div>
            </div>
          )}

          {stage.kind === 'error' && (
            <ErrorState title="That didn’t work" message={stage.message} onRetry={() => setStage({ kind: 'idle' })} />
          )}
        </div>

        {log.length > 0 && (
          <details className="patch-log">
            <summary>Details for support</summary>
            <pre>{log.join('\n')}</pre>
          </details>
        )}
      </div>

      {stage.kind === 'ready' && confirming && (
        <ConfirmDialog
          action={confirming} info={stage.info} version={fw?.version} foreign={isForeign(fw) ? fw!.project : null}
          file={fw?.source === 'files' && confirming !== 'new-pin' ? { names: fw.files.join(', '), fingerprint } : null}
          onCancel={() => setConfirming(null)} onConfirm={() => void run(confirming)}
        />
      )}
    </>
  );
}

/* ESP-IDF stamps the build time as "Oct 13 2026 13:49:15"; show it as a date. */
function builtOn(builtAt: string): string {
  const d = new Date(builtAt.replace(/^(\w{3}) +(\d{1,2}) (\d{4})/, '$1 $2, $3'));
  return Number.isNaN(d.getTime()) ? '' : formatDate(d.toISOString());
}

/** Firmware whose app doesn't call itself wearwise-esp32: allowed, but never unasked. */
const isForeign = (fw: Firmware | null | undefined): boolean => !!fw && fw.project !== 'wearwise-esp32';

function FirmwareSource({ bundled, picked, error, disabled, onFiles, onUseBundled }: {
  bundled: AsyncState<Firmware | null>; picked: Firmware | null; error: string | null; disabled: boolean;
  onFiles: (e: ChangeEvent<HTMLInputElement>) => void; onUseBundled: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const b = bundled.data;
  return (
    <div className="card patch-firmware">
      <div className="patch-firmware-row">
        <Icon name="cpu" size={18} />
        <div className="titles">
          <span className="overline">Firmware to install</span>
          {picked ? (
            <span>
              <strong>{picked.version}</strong> <span className="muted">from {picked.files.join(', ')}{builtOn(picked.builtAt) ? `, built ${builtOn(picked.builtAt)}` : ''}</span>
            </span>
          ) : bundled.status === 'loading' ? (
            <span className="muted">Checking the included firmware…</span>
          ) : b ? (
            <span>
              <strong>{b.version}</strong> <span className="muted">included with the dashboard{builtOn(b.builtAt) ? `, built ${builtOn(b.builtAt)}` : ''}</span>
            </span>
          ) : (
            <span className="muted">None included. Choose a firmware file, or just give a patch a new PIN.</span>
          )}
          {isForeign(picked) && (
            <span><Badge tone="warning" icon="triangle-alert">Not WearWise firmware: “{picked!.project}”</Badge></span>
          )}
        </div>
        <div className="row">
          {picked && b && <Button variant="ghost" size="sm" onClick={onUseBundled} disabled={disabled}>Use included {b.version}</Button>}
          <Button size="sm" icon="upload" onClick={() => input.current?.click()} disabled={disabled}>Choose file…</Button>
          <input ref={input} type="file" accept=".bin,application/octet-stream" multiple hidden onChange={onFiles} />
        </div>
      </div>
      {error && <Alert kind="error" title="That file can’t be installed">{error}</Alert>}
      {bundled.status === 'error' && !picked && <Alert kind="error" title="The included firmware can’t be used">{bundled.error}</Alert>}
      <details className="small muted patch-files-help">
        <summary>Which files can I choose?</summary>
        <p>
          The WearWise firmware file you were given (it ends in <code>.bin</code>). From a firmware build you can also
          choose <code>wearwise-esp32.bin</code> on its own, the three files <code>bootloader.bin</code>,{' '}
          <code>partition-table.bin</code> and <code>wearwise-esp32.bin</code> together, or one combined file
          (<code>merged-binary.bin</code>). Anything else is refused before it reaches the patch.
        </p>
      </details>
    </div>
  );
}

const WORKING: Record<PatchAction | 'erase', string> = { 'set-up': 'Setting up', update: 'Updating', 'new-pin': 'Setting up', erase: 'Erasing' };

const ACTIONS: { action: PatchAction; title: string; button: string; icon: string; body: (v: string, same: boolean) => string }[] = [
  {
    action: 'set-up', title: 'Set up as a new patch', button: 'Set up', icon: 'usb',
    body: (v) => `Installs firmware ${v}, gives the patch a new PIN and erases its settings: it forgets every paired phone and its Wi-Fi.`,
  },
  {
    action: 'update', title: 'Update firmware', button: 'Update', icon: 'upload',
    body: (v, same) => `${same ? `Reinstalls firmware ${v} (already installed)` : `Installs firmware ${v}`}. Keeps the PIN, paired phones and Wi-Fi.`,
  },
  {
    action: 'new-pin', title: 'New participant', button: 'New PIN', icon: 'key',
    body: () => 'A new PIN, and the patch forgets every paired phone and its Wi-Fi. The firmware stays as it is.',
  },
];

function ReadyView({ info, notice, fw, blocked, onAction, onErase, onDisconnect }: {
  info: PatchInfo; notice?: string; fw: Firmware | null | undefined; blocked: Record<PatchAction, string | null>;
  onAction: (a: PatchAction) => void; onErase: () => void; onDisconnect: () => void;
}) {
  const [showPin, setShowPin] = useState(false);
  const bundled = fw?.version;
  const installed = info.app?.version;
  return (
    <div className="patch-step">
      <div className="section-head">
        <h2>{info.name}</h2>
        <Button icon="unplug" onClick={onDisconnect}>Disconnect</Button>
      </div>
      <p className="small muted">
        Connected over USB. While it is connected here the patch isn’t running, so phones can’t see it.
        Disconnect when you’re done: it restarts and works again.
      </p>
      {notice && <Alert kind="success" title="Erased">{notice}</Alert>}
      <div className="facts">
        <div className="fact">
          <span className="overline">Firmware</span>
          <span className="value">{installed ?? (info.layout ? 'None found' : 'None')}</span>
          {bundled && installed && installed !== bundled && <Badge tone="info">{bundled} available</Badge>}
        </div>
        <div className="fact">
          <span className="overline">Bluetooth PIN</span>
          {info.record ? (
            <span className="value row">
              {showPin ? formatPin(info.record.pin) : '••• •••'}
              <button type="button" className="text-link small" onClick={() => setShowPin((s) => !s)}>{showPin ? 'Hide' : 'Show'}</button>
            </span>
          ) : info.layout
            ? <><span className="value">No label PIN</span><span className="small muted">It uses one it made up itself</span></>
            : <><span className="value">None</span><span className="small muted">Empty patch</span></>}
          {info.record && <span className="small muted">Set {formatDate(info.record.provisionedAt.toISOString())}</span>}
        </div>
        <div className="fact" title={info.chip}><span className="overline">Device ID</span><span className="small">{info.mac.toUpperCase()}</span></div>
      </div>

      {showPin && info.record && (
        <div className="row">
          <PatchLabel name={info.name} record={info.record} version={installed ?? null} />
          <Button icon="printer" onClick={() => window.print()}>Print label</Button>
        </div>
      )}

      <ul className="patch-actions">
        {ACTIONS.map(({ action, title, button, icon, body }) => (
          <li key={action}>
            <div className="titles">
              <strong>{title}</strong>
              <span className="small muted">{blocked[action] ?? body(bundled ?? '', installed === bundled)}</span>
            </div>
            <Button
              variant={action === 'set-up' && !info.record ? 'primary' : 'secondary'} icon={icon}
              disabled={!!blocked[action]} onClick={() => onAction(action)} aria-label={`${title}: ${button}`}
            >
              {button}
            </Button>
          </li>
        ))}
        <li className="danger">
          <div className="titles">
            <strong>Erase everything</strong>
            <span className="small muted">
              Empties the patch: firmware, Bluetooth PIN, paired phones and Wi-Fi are all wiped, and it does nothing
              until it is set up again. Press and hold the button for 2 seconds.
            </span>
          </div>
          <HoldButton icon="trash-2" label="Erase everything: press and hold for 2 seconds" onConfirm={onErase}>
            Hold to erase
          </HoldButton>
        </li>
      </ul>
    </div>
  );
}

function ConfirmDialog({ action, info, version, foreign, file, onCancel, onConfirm }: {
  action: PatchAction; info: PatchInfo; version: string | undefined; foreign: string | null;
  file: { names: string; fingerprint: string | null } | null;
  onCancel: () => void; onConfirm: () => void;
}) {
  const title = action === 'new-pin' ? `Give ${info.name} a new PIN?`
    : action === 'update' ? `Install “${foreign}” on ${info.name}?` : `Set up ${info.name} as a new patch?`;
  return (
    <Dialog open onClose={onCancel} labelledBy="patch-confirm-title">
      <div className="dialog-body">
        <h2 id="patch-confirm-title">{title}</h2>
        {foreign && action !== 'new-pin' && (
          <Alert kind="warning" title="This isn’t WearWise firmware">
            The app image calls itself “{foreign}”. The patch won’t work with the WearWise app until WearWise firmware is installed again.
          </Alert>
        )}
        {file && (
          <Alert kind="info" title="Firmware from a file">
            {file.names}. Only install firmware from someone you trust.
            {file.fingerprint && <> Its fingerprint (SHA-256) is <code className="fingerprint">{file.fingerprint}</code>: check it matches what they sent you.</>}
          </Alert>
        )}
        {action === 'update' ? (
          <p>Firmware {version ?? ''} is installed. The PIN, paired phones and Wi-Fi are kept.</p>
        ) : (
          <p>
            {action === 'set-up' && `Firmware ${version ?? ''} is installed and the patch gets a new PIN. `}
            Every phone paired with it is unpaired and it forgets its Wi-Fi. {info.record ? 'Its current label stops working: print the new one.' : ''}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>{action === 'new-pin' ? 'Give it a new PIN' : action === 'update' ? 'Install it' : 'Set it up'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The label: what the participant needs to pair, sized for a small sticker when printed. */
function PatchLabel({ name, record, version }: { name: string; record: FactoryRecord; version: string | null }) {
  return (
    <div className="patch-label">
      <strong className="patch-label-name">{name}</strong>
      <span className="overline">Bluetooth PIN</span>
      <span className="patch-label-pin">{formatPin(record.pin)}</span>
      <span className="patch-label-foot">
        WearWise{version ? ` · firmware ${version}` : ''} · {formatDate(record.provisionedAt.toISOString())}
      </span>
    </div>
  );
}
