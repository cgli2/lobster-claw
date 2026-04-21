#!/bin/bash
# OpenClaw Git Bash PATH Fix - One-click solution
# Usage: bash ./fix-openclaw-path.sh

echo "🔧 Fixing OpenClaw PATH for Git Bash..."
echo ""

NPM_GLOBAL_DIR="$HOME/.npm-global"
NPM_GLOBAL_UNIX=$(cygpath -u "$NPM_GLOBAL_DIR" 2>/dev/null || echo "$NPM_GLOBAL_DIR")

# Check if openclaw.cmd exists
if [[ ! -f "$NPM_GLOBAL_DIR/openclaw.cmd" ]]; then
    echo "❌ Error: openclaw.cmd not found at $NPM_GLOBAL_DIR"
    echo "   OpenClaw may not be installed correctly."
    exit 1
fi

# Create Unix-style wrapper if it doesn't exist
if [[ ! -f "$NPM_GLOBAL_DIR/openclaw" ]]; then
    echo "Creating Unix-style wrapper script..."
    cat > "$NPM_GLOBAL_DIR/openclaw" << 'EOF'
#!/bin/bash
exec node "$HOME/.npm-global/node_modules/openclaw/openclaw.mjs" "$@"
EOF
    chmod +x "$NPM_GLOBAL_DIR/openclaw"
    echo "✓ Created wrapper at $NPM_GLOBAL_UNIX/openclaw"
else
    echo "✓ Wrapper script already exists"
fi

# Add to ~/.bashrc if not present
if ! grep -q "npm-global" ~/.bashrc 2>/dev/null; then
    echo "" >> ~/.bashrc
    echo "# OpenClaw - Add npm global directory to PATH" >> ~/.bashrc
    echo "export PATH=\"$NPM_GLOBAL_UNIX:\$PATH\"" >> ~/.bashrc
    echo "export PATH=\"$NPM_GLOBAL_UNIX/bin:\$PATH\"" >> ~/.bashrc
    echo "✓ Added PATH exports to ~/.bashrc"
else
    echo "✓ PATH already configured in ~/.bashrc"
fi

# Export for current session
export PATH="$NPM_GLOBAL_UNIX:$PATH"
export PATH="$NPM_GLOBAL_UNIX/bin:$PATH"

echo ""
echo "✅ PATH fixed successfully!"
echo ""

# Verify
if command -v openclaw &> /dev/null; then
    echo "✓ openclaw command is now available"
    echo ""
    echo "Current version:"
    openclaw --version
    echo ""
    echo "⚠️  Note: Please restart your terminal or run 'source ~/.bashrc' for changes to persist."
else
    echo "⚠️  openclaw command still not found. Trying manual path..."
    if [[ -x "$NPM_GLOBAL_DIR/openclaw" ]]; then
        echo "Testing with full path:"
        "$NPM_GLOBAL_DIR/openclaw" --version
    fi
fi
