# Build Configuration Profiles

Custom configuration files for different build scenarios.

## Available Configurations

### models-minimal.json
Contains only Sonnet 4.5 and Haiku 4.5 models.
- Use for lightweight distributions
- Reduces choice complexity for users
- Ideal for cost-conscious deployments

### models-premium.json
Contains only Opus 4.6 and Opus 4.5 models.
- Use for premium/enterprise distributions
- Focus on most capable models
- Ideal for high-quality output requirements

## Usage

### Default Build (All 4 Models)
```bash
cd apps/electron
bun run build
bun run dist:mac
```

### Minimal Build (Sonnet + Haiku)
```bash
cd apps/electron
CUSTOM_MODELS_CONFIG=build-configs/models-minimal.json bun run build
bun run dist:mac
```

### Premium Build (Opus Only)
```bash
cd apps/electron
CUSTOM_MODELS_CONFIG=build-configs/models-premium.json bun run build
bun run dist:mac
```

### Custom Build (Your Own Config)
```bash
cd apps/electron
CUSTOM_MODELS_CONFIG=/path/to/your-config.json bun run build
bun run dist:mac
```

## Creating Custom Configurations

1. Copy an existing config file as a template:
   ```bash
   cp build-configs/models-minimal.json build-configs/my-custom-config.json
   ```

2. Edit the `availableModels` array:
   - Add new models
   - Remove unwanted models
   - Reorder models (order determines dropdown order)
   - Customize names and descriptions

3. Use your custom config during build:
   ```bash
   CUSTOM_MODELS_CONFIG=build-configs/my-custom-config.json bun run build
   ```

## Configuration File Structure

```json
{
  "version": "1.0",
  "description": "Your description here",
  "defaults": {
    "authType": "api_key",
    "notificationsEnabled": true,
    "colorTheme": "default",
    "autoCapitalisation": true,
    "sendMessageKey": "enter",
    "spellCheck": false,
    "availableModels": [
      {
        "id": "claude-model-id",
        "name": "Model Display Name",
        "shortName": "Short Name",
        "description": "Model description",
        "contextWindow": 200000
      }
    ]
  },
  "workspaceDefaults": {
    "thinkingLevel": "think",
    "permissionMode": "safe",
    "cyclablePermissionModes": ["safe", "ask", "allow-all"],
    "localMcpServers": {
      "enabled": true
    }
  }
}
```

## Verification

After building with a custom config:

1. Install the built app
2. Open **Settings > App**
3. Check the **Model** dropdown
4. Verify only your configured models appear

## CI/CD Integration

For automated builds in GitHub Actions or similar:

```yaml
- name: Build with minimal config
  run: |
    cd apps/electron
    bun run build
    bun run dist:mac
  env:
    CUSTOM_MODELS_CONFIG: build-configs/models-minimal.json
```

## Notes

- Config files use JSON format (strict syntax, no comments)
- Changes require rebuilding and reinstalling the app
- End users can still customize via `~/.opentomo/config-defaults.json` after installation
- The `CUSTOM_MODELS_CONFIG` variable only affects the build-time default configuration
