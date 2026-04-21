#!/bin/sh
# Linux 兼容的语言包过滤脚本
# 功能：调用 filter-locales.js 过滤 Electron 构建后的语言包

echo "正在过滤语言包..."
node scripts/filter-locales.js
echo "语言包过滤完成"
