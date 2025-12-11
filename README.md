# Tagtics Client

[![npm version](https://badge.fury.io/js/tagtics-client.svg)](https://www.npmjs.com/package/tagtics-client)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![GitHub stars](https://img.shields.io/github/stars/tagtics/tagtics-client.svg?style=social&label=Star)](https://github.com/tagtics/tagtics-client)

The client-side package for the Tagtics SaaS platform - A premium feedback collection tool with modern Glassmorphism UI.

## Features
 
 **Premium Glassmorphism UI** - Modern dark theme with blur effects  
 **Professional SVG Icons** - Clean, vector-based interface  
 **Smart Interactions** - Enter to submit, Escape to cancel  
 **Element Picker** - Visual element selection with hover highlights  
 **Path Control** - Regex-based visibility configuration  
 **Re-pick Support** - Easy element reselection  

## Installation


```bash
npm install tagtics-client
```

## Quick Start

### React / Next.js

```tsx
// src/App.tsx or app/layout.tsx
import { useEffect } from 'react';
import Tagtics from 'tagtics-client';

function App() {
  useEffect(() => {
    Tagtics.init({
      apiKey: 'YOUR_API_KEY',
      // Optional: Control where widget appears
      includePaths: ['.*'], // Show everywhere
      // excludePaths: ['/admin.*'], // Hide on admin pages
    });

    return () => Tagtics.destroy();
  }, []);

  return <YourApp />;
}
```

### Vue 3

```vue
<!-- App.vue -->
<script setup>
import { onMounted, onUnmounted } from 'vue';
import Tagtics from 'tagtics-client';

onMounted(() => {
  Tagtics.init({
    apiKey: 'YOUR_API_KEY',
  });
});

onUnmounted(() => {
  Tagtics.destroy();
});
</script>

<template>
  <YourApp />
</template>
```

### Angular

```typescript
// app.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import Tagtics from 'tagtics-client';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  ngOnInit() {
    Tagtics.init({
      apiKey: 'YOUR_API_KEY',
    });
  }

  ngOnDestroy() {
    Tagtics.destroy();
  }
}
```

### Svelte / SvelteKit

```svelte
<!-- +layout.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import Tagtics from 'tagtics-client';

  onMount(() => {
    Tagtics.init({
      apiKey: 'YOUR_API_KEY',
    });
  });

  onDestroy(() => {
    Tagtics.destroy();
  });
</script>

<slot />
```

### Solid.js

```tsx
// App.tsx
import { onMount, onCleanup } from 'solid-js';
import Tagtics from 'tagtics-client';

function App() {
  onMount(() => {
    Tagtics.init({
      apiKey: 'YOUR_API_KEY',
    });
  });

  onCleanup(() => {
    Tagtics.destroy();
  });

  return <YourApp />;
}
```

### Vanilla JavaScript / HTML

**For static sites, server-rendered apps (PHP, Django, Rails, etc.), or any HTML page:**

```html
<!-- Using UMD bundle from CDN -->
<script src="https://unpkg.com/tagtics-client/dist/index.umd.js"></script>
<script>
  Tagtics.init({
    apiKey: 'YOUR_API_KEY',
  });
</script>
```

```javascript
// Using ES Modules (if you have a build step)
import Tagtics from 'tagtics-client';

Tagtics.init({
  apiKey: 'YOUR_API_KEY',
});
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **Required** | Your project API key from tagtics.online |
| `includePaths` | `string[]` | `undefined` | Regex patterns - show widget ONLY on matching paths |
| `excludePaths` | `string[]` | `undefined` | Regex patterns - HIDE widget on matching paths |
| `logoUrl` | `string` | `undefined` | Custom logo URL to replace default icon |
| `serializeChildDepth` | `number` | `0` | How deep to capture child elements (0 = selected only) |
| `privacyNotice` | `string` | Default text | Custom privacy notice shown in modal |
| `allowSensitivePages` | `boolean` | `false` | Allow widget on detected payment/checkout pages |

 **Important**: `includePaths` and `excludePaths` are **mutually exclusive** - use only one, not both.

 **SPA Support**: Tagtics automatically detects route changes in Single Page Applications (React, Vue, Angular, etc.) and shows/hides the widget based on your path configuration.

### Path Control

**Option 1: Whitelist (includePaths)**
```javascript
Tagtics.init({
  apiKey: 'YOUR_API_KEY',
  includePaths: ['.*'],  // Show everywhere
  // OR
  includePaths: ['/dashboard.*', '/app.*'],  // Show only on these paths
});
```

**Option 2: Blacklist (excludePaths)**
```javascript
Tagtics.init({
  apiKey: 'YOUR_API_KEY',
  excludePaths: ['/admin.*', '/login', '/signup'],  // Hide on these paths
});
```

**Regex Examples:**
- `'.*'` - Match everything
- `'/dashboard.*'` - Match /dashboard, /dashboard/settings, etc.
- `'/login'` - Match exactly /login
- `'.*checkout.*'` - Match any path containing "checkout"


## Advanced Usage

### Custom Logo

```javascript
Tagtics.init({
  apiKey: 'YOUR_API_KEY',
  logoUrl: 'https://your-domain.com/logo.png',
});
```

### Custom Privacy Notice

```javascript
Tagtics.init({
  apiKey: 'YOUR_API_KEY',
  privacyNotice: 'We only capture UI structure, never form values or personal data.',
});
```

## Keyboard Shortcuts

- **Enter** - Submit feedback (Shift+Enter for new line)
- **Escape** - Cancel picking mode or close modal
- **Ctrl+R / F5** - Reload page (works during feedback mode)

## Security

The `apiKey` is exposed in frontend code. Implement backend validation and rate limiting. For production, consider proxying requests through your backend.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/tagtics/tagtics-client/issues) with:
- Clear description of the problem/feature
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Browser/framework versions

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build`
6. Commit with clear messages (`git commit -m 'feat: add amazing feature'`)
7. Push to your fork (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Development Setup

```bash
# Clone the repo
git clone https://github.com/tagtics/tagtics-client.git
cd tagtics-client

# Install dependencies
npm install

# Build the package
npm run build

# Run example
npm run dev-server
# Open http://localhost:3000/examples/example-app.html
```

### Code Style

- Use TypeScript for type safety
- Follow existing code patterns
- Add comments for complex logic
- Keep functions focused and small

## Community

- [Report bugs](https://github.com/tagtics/tagtics-client/issues)
- [Request features](https://github.com/tagtics/tagtics-client/issues)
- [Star the repo](https://github.com/tagtics/tagtics-client) if you find it useful!
- [Contribute](https://github.com/tagtics/tagtics-client/pulls)

## License

ISC © [rishi-rj-s](https://github.com/rishi-rj-s)

See [LICENSE](./LICENSE) for details.
