/* Bluetooth pairing policy — who may pair with the patch, and with what code.
 *
 * Every sensitive characteristic requires an encrypted, AUTHENTICATED link
 * (LE Secure Connections + MITM), so a phone must pair before it can read the
 * device info (which carries the Wi-Fi PoP), control streaming, provision Wi-Fi,
 * or receive data. Pairing uses a 6-digit passkey the patch "displays": it has no
 * screen, so the passkey is random per patch and printed on its label. The
 * patch-setup page (researcher dashboard) generates it and writes it to the `wwcfg`
 * factory partition (core/factory_config.h). A board flashed without that page falls
 * back to a passkey generated on first boot and kept in NVS. Only that fallback is
 * printed on the serial console (the board has no label); a label PIN never is.
 *
 * New phones may pair only (a) when the patch has no bonds yet — first setup — or
 * (b) within PAIRING_WINDOW_S after the BOOT button is pressed. A bonded phone
 * reconnects without pairing again.
 *
 * Lock-out: the passkey is static (it is on the label), and LE Secure Connections
 * passkey entry leaks it about one bit per failed attempt to an active attacker. So
 * after MAX_FAILED_PAIRINGS (3) failed passkey pairings — wrong PIN, cancelled, timed
 * out, or the phone hung up after the PIN step — pairing is closed, first setup
 * included, until the BOOT button is pressed. The count is kept in NVS (a reboot does
 * not reset it) and is cleared by a BOOT press or a successful pairing.
 *
 * Two devices: when a phone or tablet completes a NEW passkey pairing and bonds, the
 * patch keeps that bond and the most recent other one (WW_MAX_PAIRED_DEVICES) and
 * deletes any older ones, so someone can use it with a phone and a tablet without
 * re-pairing each time they switch, while a stray bond still cannot linger: a third
 * device needs the PIN and the BOOT button like any new one, and pushes out the
 * oldest. Only one device is connected at a time (CONFIG_BT_NIMBLE_MAX_CONNECTIONS).
 * (Firmware before 0.9.6 kept a single owner.)
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "host/ble_hs.h"

void ww_pairing_init(void);

/* The patch's 6-digit passkey (0..999999). */
uint32_t ww_pairing_passkey(void);

/* True when the passkey is the factory label PIN. It is then never printed on the
   console: the label is where it is read. */
bool ww_pairing_pin_on_label(void);

/* May a NEW phone pair right now? */
bool ww_pairing_allowed(void);

/* A passkey pairing failed after the patch displayed its PIN (wrong PIN, cancelled,
   timed out, or the phone hung up). Counts toward the lock-out. */
void ww_pairing_failed(void);

/* How many phones/tablets a patch remembers. */
#define WW_MAX_PAIRED_DEVICES 2

/* A new phone completed an authenticated LE Secure Connections pairing: close the
   BOOT-button window, clear the failure count and, if it bonded, delete the bonds
   beyond the newest WW_MAX_PAIRED_DEVICES. `peer` is its identity address. */
void ww_pairing_succeeded(const ble_addr_t *peer, bool bonded);

/* Number of phones currently bonded. */
int ww_pairing_bond_count(void);

/* Delete every stored bond that is not LE Secure Connections + passkey-authenticated
   with a 128-bit key. Such a bond can only come from a pairing that skipped the
   passkey ("Just Works") or from older firmware; purging it stops an unpaired device
   from filling the bond table and evicting the real phone. Call once the BLE host has
   synced. */
void ww_pairing_purge_weak_bonds(void);

/* For ble_hs_cfg.store_status_cb. NimBLE's stock handler makes room for a new bond by
   deleting the OLDEST one, so any pairing could evict the real phone. This one only
   makes room for an authenticated bond while pairing is allowed; otherwise the new
   bond is simply not stored. */
int ww_pairing_store_status(struct ble_store_status_event *event, void *arg);
