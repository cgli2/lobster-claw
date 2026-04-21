#!/bin/bash
# Fix Git Bash (MINGW64) PATH to include npm global directory

NPM_GLOBAL_DIR="$HOME/.npm-global"

# Convert Windows path to Unix-style for Git Bash
NPM_GLOBAL_UNIX=$(cygpath -u "$NPM_GLOBAL_DIR" 2>/dev/null || echo "$NPM_GLOBAL_DIR")

# Add to PATH if not already present
if [[ ":$PATH:" != *":$NPM_GLOBAL_UNIX/bin:"* ]]; then
    export PATH="$NPM_GLOBAL_UNIX/bin:$PATH"
    echo "✓ Added $NPM_GLOBAL_UNIX/bin to PATH"
else
    echo "✓ npm global bin directory already in PATH"
fi

# Verify openclaw command is available
if command -v openclaw &> /dev/null; then
    echo "✓ openclaw command found!"
    openclaw --version
else
    echo "⚠ openclaw command still not found. Trying Windows CMD path..."
    # Try Windows-style path
    if [[ -f "$HOME/.npm-global/openclaw.cmd" ]]; then
        echo "Found openclaw.cmd, creating wrapper..."
        cat > "$HOME/.npm-global/openclaw" << 'EOF'
#!/bin/bash
exec node "$HOME/.npm-global/node_modules/openclaw/openclaw.mjs" "$@"
EOF
        chmod +x "$HOME/.npm-global/openclaw"
        export PATH="$HOME/.npm-global:$PATH"
        echo "✓ Created Unix-style wrapper script"
    fi
fi
