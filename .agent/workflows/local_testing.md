---
description: How to test the package locally in other projects using npm link
---

# Testing Tagtics Client Locally

You can use `npm link` to symlink this package to other projects on your machine. This allows you to test changes immediately without publishing to npm.

## 1. Prepare the Package
In the `tagtics-client` directory (where `package.json` is):

```bash
# 1. Build the latest version
npm run build

# 2. Create the global symlink
npm link
```

## 2. Link in Your Target Project
Navigate to your other project (e.g., a React or Vue app):

```bash
cd /path/to/your/other/project

# Link the package
npm link tagtics-client
```

## 2a. Using pnpm?
If your other project uses `pnpm`, the command is slightly different. Pnpm works best by linking the directory path directly.

In your **other project**:
```bash
# Link using the absolute path to this package
pnpm link D:\Misc\Tagtics\Package
```
This is often more reliable than using the global store with pnpm.

## 3. Usage
Now you can import it in your project as if it were installed from npm:

```javascript
import Tagtics from 'tagtics-client';

Tagtics.init({
  apiKey: 'TEST_KEY',
  // ...
});
```

## 4. Reflecting Changes
Because it is a symlink, any changes you make in `tagtics-client` will appear in your project.

1.  **Edit** source code in `tagtics-client`.
2.  **Rebuild**: Run `npm run build` (essential, as the other project reads the `dist` folder).
3.  **Refresh**: Your other project should see the changes (you might need to restart its dev server).

## 5. Unlinking
When you are done:

```bash
# In your target project
npm unlink tagtics-client
npm install tagtics-client # Reinstall the real version if needed

# In tagtics-client directory
npm unlink
```
