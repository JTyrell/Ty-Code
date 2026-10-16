export interface DownloadConfig {
  windows: string;
  macos: string;
  linux: string;
  checksums: string;
}

export const DOWNLOAD_URLS: DownloadConfig = {
  windows: 'https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-Setup-1.0.0.exe',
  macos: 'https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.dmg',
  linux: 'https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.AppImage',
  checksums: 'https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/SHA256SUMS.txt'
};

export default DOWNLOAD_URLS;
