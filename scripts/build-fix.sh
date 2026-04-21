#!/bin/bash

# 清理旧文件
echo "Cleaning up..."
rm -rf dist/

# 运行 electron-builder
echo "Building with electron-builder..."
npx electron-builder --win --x64

# 检查是否成功
if [ $? -eq 0 ]; then
    echo "Build successful!"
    ls -la dist/
else
    echo "Build failed!"
    exit 1
fi
