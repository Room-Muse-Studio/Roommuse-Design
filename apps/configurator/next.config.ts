import type { NextConfig } from 'next';

const config: NextConfig = {
  // The scan SDK is a workspace package shipped as TypeScript source.
  transpilePackages: ['@mozu/scan-sdk'],
};

export default config;
