#!/bin/bash

LOCKFILE="/var/lock/sandbox-init.lock"
APP_DIR="${1}"
BUNDLE_PATH="${2}"

# 1. Safety check: Ensure variables aren't empty before destructive actions
if [[ -z "$APP_DIR" || -z "$BUNDLE_PATH" ]]; then
    echo "Usage: $0 <app_dir> <bundle_path>"
    exit 1
fi

# 2. Use a subshell to isolate the lock
(
    # Acquire exclusive lock. Exit if locked.
    flock -n 99 || { echo "Setup is already in progress..."; exit 1; }

    # 3. Cleanup Trap: Removes the lock file only when this process exits
    # Note: On many systems /var/lock is cleared on reboot, but this is cleaner.
    trap 'rm -f $LOCKFILE' EXIT

    echo "Cleaning and cloning..."
    # 4. Use 'set -e' so the script stops if a command fails
    set -e 

    rm -rf "$APP_DIR"
    mkdir -p "$APP_DIR"
    cd "$APP_DIR"
    
    git clone "$BUNDLE_PATH" .
    bun install

    echo "Starting server and holding lock..."
    # The script is running in sandbox.startProcess, so we can just run the dev command
    bun run dev
) 99>"$LOCKFILE"


