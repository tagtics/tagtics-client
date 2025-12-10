# Tagtics Client

The client side package for the Tagtics SaaS platform.

## Quickstart

### Installation

```bash
npm install tagtics-client
```

### Usage

#### Static HTML

```html
<script src="https://unpkg.com/tagtics-client/dist/index.umd.js"></script>
<script>
  Tagtics.init({
    apiKey: 'YOUR_PROJECT_KEY',
    // ... options
  });
</script>
```

#### ES Modules

```javascript
import Tagtics from 'tagtics-client';

Tagtics.init({
  apiKey: 'YOUR_PROJECT_KEY'
});
```

## Configuration

| Option | Type | Default | Description |
|Params|---|---|---|
| `apiKey` | string | **Required** | Your project API key. |
| `include` | string[] | `undefined` | List of path prefixes to include. Mutually exclusive with `exclude`. |
| `exclude` | string[] | `undefined` | List of path prefixes to exclude. Mutually exclusive with `include`. |
| `iconPosition` | object | `{ bottom: '24px', right: '24px' }` | Position of the floating button. |
| `serializeChildDepth` | number | `0` | Depth of children to serialize. |
| `privacyNotice` | string | Default text | Custom privacy notice text. |
| `allowSameOriginIframe` | boolean | `false` | Allow injection into same-origin iframes. |
| `allowSensitivePages` | boolean | `false` | Allow running on detected payment/sensitive pages (requires user confirmation). |

## Security Note

The `apiKey` is exposed in the frontend code. Ensure you have proper backend validation and rate limiting. For production, consider proxying requests through your own backend to keep the key hidden if needed, although this package is designed for client-side integration.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

### Dev Server

```bash
npm run dev-server
```

Open `examples/example-app.html` in your browser (via a local server or file protocol, though file protocol might have CORS issues with modules).

## License

ISC
