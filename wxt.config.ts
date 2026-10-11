import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'ReviewLoad',
    description: "See each teammate's pending review requests right in GitHub's reviewer picker.",
    permissions: ['storage'],
    host_permissions: ['https://api.github.com/*'],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'reviewload@charliegroves.dev',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['authenticationInfo'] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
  zip: {
    // README images and video; not needed to rebuild the extension.
    excludeSources: ['docs/**'],
  },
});
