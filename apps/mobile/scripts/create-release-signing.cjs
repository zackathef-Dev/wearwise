const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const key = path.join(root, 'wearwise-release.jks');
const properties = path.join(root, 'key.properties');
if (fs.existsSync(key) || fs.existsSync(properties)) throw new Error('Signing material already exists; refusing to overwrite.');
const password = crypto.randomBytes(32).toString('hex');
const result = spawnSync('keytool', ['-genkeypair', '-noprompt', '-keystore', key,
  '-storetype', 'PKCS12', '-storepass:env', 'WW_SIGNING_PASSWORD', '-keypass:env', 'WW_SIGNING_PASSWORD',
  '-alias', 'wearwise-release', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
  '-dname', 'CN=WearWise Project Team, O=La Trobe University Capstone Project, C=AU'],
  { env: { ...process.env, WW_SIGNING_PASSWORD: password }, encoding: 'utf8' });
if (result.status !== 0) throw new Error('Key generation failed. Check the local Java keytool installation.');
fs.writeFileSync(properties, `storeFile=wearwise-release.jks\nstorePassword=${password}\nkeyAlias=wearwise-release\nkeyPassword=${password}\n`, { mode: 0o600, flag: 'wx' });
if (process.platform === 'win32') {
  const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  for (const file of [key, properties]) {
    const acl = spawnSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `${account}:F`, 'SYSTEM:F'], { encoding: 'utf8' });
    if (acl.status !== 0) throw new Error('Signing material created, but Windows file access could not be restricted. Protect these files before continuing.');
  }
}
console.log('Created local release signing material. Back up both ignored signing files securely.');
