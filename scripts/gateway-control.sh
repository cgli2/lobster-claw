#!/bin/bash
# OpenClaw Gateway Control Script
# Usage: 
#   ./gateway-control.sh start
#   ./gateway-control.sh stop  
#   ./gateway-control.sh restart
#   ./gateway-control.sh status

ACTION="$1"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

case "$ACTION" in
    start)
        echo "Starting gateway on port $PORT..."
        # Use --force to kill any existing process on the port
        openclaw gateway --force > /tmp/openclaw-gateway.log 2>&1 &
        GW_PID=$!
        echo $GW_PID > ~/.openclaw/gateway.pid
        
        # Wait for startup
        sleep 3
        
        if kill -0 $GW_PID 2>/dev/null; then
            echo "✓ Gateway started (PID: $GW_PID)"
            exit 0
        else
            echo "✗ Gateway failed to start"
            exit 1
        fi
        ;;
        
    stop)
        echo "Stopping gateway..."
        
        # Method 1: Kill by PID file
        if [ -f ~/.openclaw/gateway.pid ]; then
            GW_PID=$(cat ~/.openclaw/gateway.pid)
            if kill -0 $GW_PID 2>/dev/null; then
                kill -9 $GW_PID 2>/dev/null
                echo "✓ Gateway stopped (PID: $GW_PID)"
            fi
            rm -f ~/.openclaw/gateway.pid
        fi
        
        # Method 2: Kill by port (fallback)
        WIN_PID=$(netstat -ano | grep ":$PORT" | grep LISTENING | awk '{print $NF}' | head -1)
        if [ -n "$WIN_PID" ]; then
            taskkill //F //PID $WIN_PID >/dev/null 2>&1
            echo "✓ Gateway stopped (port $PORT)"
        fi
        
        exit 0
        ;;
        
    restart)
        echo "Restarting gateway..."
        "$0" stop
        sleep 1
        "$0" start
        exit $?
        ;;
        
    status)
        # Check if listening on port
        WIN_PID=$(netstat -ano | grep ":$PORT" | grep LISTENING | awk '{print $NF}' | head -1)
        
        if [ -n "$WIN_PID" ]; then
            echo "✓ Gateway is running (PID: $WIN_PID, Port: $PORT)"
            
            # Show additional info
            if [ -f ~/.openclaw/gateway.pid ]; then
                GW_PID=$(cat ~/.openclaw/gateway.pid)
                echo "  Process PID: $GW_PID"
            fi
            
            exit 0
        else
            echo "✗ Gateway is not running"
            exit 1
        fi
        ;;
        
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
