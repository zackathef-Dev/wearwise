# 3.10 Encryption proof — physical Android, 26 Aug 2026

Device: Samsung SM-G977N, Android 12. App: io.wearwise.participant debug build.
Files pulled with `adb exec-out run-as io.wearwise.participant cat /data/user/0/io.wearwise.participant/databases/wearwise.db{,-wal}`
after one 23 s simulated session had been saved.

- `db-head.hex`  — first 32 bytes of wearwise.db (4096 B). Plaintext SQLite would start `53 51 4c 69 74 65 20 66` ("SQLite f"). It starts `e1 c7 2f 0c`.
- `wal-head.hex` — first 32 bytes of wearwise.db-wal (1,627,432 B). `37 7f 06 82` is SQLite's WAL frame magic, which SQLCipher leaves unencrypted; the page body that follows is ciphertext.
- `grep -a -c` for "SQLite format", "CREATE TABLE", "sessions", "Simulated" over both files: 0 matches each.

The pulled database files themselves are not kept in the repository.
