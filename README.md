# QA Hub workspace

The application lives in [`hub/`](hub/README.md). Run these commands from the repository root:

```sh
npm start
npm test
npm run test:ui
```

You can also run the same commands after `cd hub`. The Node server serves `hub` directly at `http://127.0.0.1:5173/`.

When GitHub Pages publishes the repository root, the root `index.html` redirects to `hub/`, preserving the route hash. The app then loads assets and data relative to that folder. If a deployment workflow publishes only the contents of `hub`, the app works directly at the site's root as well. No deployment workflow is currently included in this repository.

See [the application README](hub/README.md) for account setup, access restrictions, imports and exports.
