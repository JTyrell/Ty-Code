import type { VerifiedRelease } from '../lib/releases';

export interface DownloadConfig {
  windows: string;
  macos: string;
  linux: string;
  checksums: string;
}

export const DOWNLOAD_URLS: DownloadConfig = {
  windows: '/api/download/Ty-Code-Setup-1.0.0.exe',
  macos: '/api/download/Ty-Code-1.0.0.dmg',
  linux: '/api/download/Ty-Code-1.0.0.AppImage',
  checksums: '/api/download/SHA256SUMS.txt'
};

export const STATIC_VERIFIED_RELEASE: VerifiedRelease = {
  status: 'verified',
  tag: 'v1.0.0',
  name: 'Ty-Code 1.0.0',
  publishedAt: '2026-10-16T10:00:00.000Z',
  releaseUrl: 'https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0',
  assets: [
    {
      name: 'Ty-Code-Setup-1.0.0.exe',
      platform: 'Windows',
      format: 'Installer',
      architecture: 'x64',
      size: 119053185,
      downloadUrl: '/api/download/Ty-Code-Setup-1.0.0.exe',
      sha256: 'effc5f6192f4c09685356bf9af405831acfc93a52f4e3c544821101a039bfe77'
    },
    {
      name: 'Ty-Code-1.0.0-portable.exe',
      platform: 'Windows',
      format: 'Portable',
      architecture: 'x64',
      size: 118792181,
      downloadUrl: '/api/download/Ty-Code-1.0.0-portable.exe',
      sha256: 'd3d412d89595120aa1cfeaddb0f88e422cb72b216fcbf46d8b42cb5431badd94'
    },
    {
      name: 'Ty-Code-1.0.0-win.zip',
      platform: 'Windows',
      format: 'Portable',
      architecture: 'x64',
      size: 175955346,
      downloadUrl: '/api/download/Ty-Code-1.0.0-win.zip',
      sha256: '70ff3844f707fbf0e7cca6aa6f0b1b9702f1bc3f06592c097254f2dfadb1ce55'
    },
    {
      name: 'Ty-Code-1.0.0.dmg',
      platform: 'macOS',
      format: 'DMG',
      architecture: 'Universal',
      size: 151630993,
      downloadUrl: '/api/download/Ty-Code-1.0.0.dmg',
      sha256: '6860d5ae0fe7b5aaa24a75d268d851b4554ce25d8d77864f2c2638d19b190420'
    },
    {
      name: 'Ty-Code-1.0.0-mac.dmg',
      platform: 'macOS',
      format: 'DMG',
      architecture: 'Universal',
      size: 151630993,
      downloadUrl: '/api/download/Ty-Code-1.0.0-mac.dmg',
      sha256: '6860d5ae0fe7b5aaa24a75d268d851b4554ce25d8d77864f2c2638d19b190420'
    },
    {
      name: 'Ty-Code-1.0.0-mac.zip',
      platform: 'macOS',
      format: 'ZIP',
      architecture: 'Universal',
      size: 151630481,
      downloadUrl: '/api/download/Ty-Code-1.0.0-mac.zip',
      sha256: 'b253cd2edca17c084be68289a31127a98fb03f040e122422eb1054ea42395b99'
    },
    {
      name: 'Ty-Code-1.0.0.AppImage',
      platform: 'Linux',
      format: 'AppImage',
      architecture: 'x64',
      size: 145260934,
      downloadUrl: '/api/download/Ty-Code-1.0.0.AppImage',
      sha256: '619b66ebe5c0197e5422771c2bde916d7930268851b7903c7c302636aa56ba7c'
    },
    {
      name: 'Ty-Code-1.0.0-x64.AppImage',
      platform: 'Linux',
      format: 'AppImage',
      architecture: 'x64',
      size: 145260934,
      downloadUrl: '/api/download/Ty-Code-1.0.0-x64.AppImage',
      sha256: '619b66ebe5c0197e5422771c2bde916d7930268851b7903c7c302636aa56ba7c'
    },
    {
      name: 'ty-code_1.0.0_amd64.deb',
      platform: 'Linux',
      format: 'DEB',
      architecture: 'x64',
      size: 145367536,
      downloadUrl: '/api/download/ty-code_1.0.0_amd64.deb',
      sha256: 'd03722551fa0a5f91a0b1e75572d910cf8ea9d996ad22c6b63f0082ef671586d'
    },
    {
      name: 'Ty-Code-1.0.0-x64.deb',
      platform: 'Linux',
      format: 'DEB',
      architecture: 'x64',
      size: 145367536,
      downloadUrl: '/api/download/Ty-Code-1.0.0-x64.deb',
      sha256: 'd03722551fa0a5f91a0b1e75572d910cf8ea9d996ad22c6b63f0082ef671586d'
    },
    {
      name: 'ty-code-1.0.0.x86_64.rpm',
      platform: 'Linux',
      format: 'RPM',
      architecture: 'x64',
      size: 145264839,
      downloadUrl: '/api/download/ty-code-1.0.0.x86_64.rpm',
      sha256: '375cf0fc86f12f631c4c5a2d70e8cc956dafa0795f6365874d8bd98bdda8015d'
    },
    {
      name: 'Ty-Code-1.0.0-x64.rpm',
      platform: 'Linux',
      format: 'RPM',
      architecture: 'x64',
      size: 145264839,
      downloadUrl: '/api/download/Ty-Code-1.0.0-x64.rpm',
      sha256: '375cf0fc86f12f631c4c5a2d70e8cc956dafa0795f6365874d8bd98bdda8015d'
    }
  ]
};

export default DOWNLOAD_URLS;
