#!/bin/bash

# Configuration
TARGET_DIR="$1"
BUNDLE_PATH="$2"
BRANCH="main" # Change to 'master' if needed

# 1. Check if the directory already exists and is a git repo
if [ -d "$TARGET_DIR/.git" ]; then
    echo "--- Existing repository found. Performing PULL ---"
    
    # Navigate into the directory
    cd "$TARGET_DIR" || exit
    
    # Pull from the bundle file
    # We use the absolute path to the bundle since we changed directories
    git pull "$BUNDLE_PATH" "$BRANCH"

else
    echo "--- No repository found. Performing CLONE ---"
    
    # Clone the bundle into the target directory
    git clone "$BUNDLE_PATH" "$TARGET_DIR"
    
    # Optional: Set the bundle as a remote named 'origin' 
    # so future pulls are easier
    cd "$TARGET_DIR" || exit
    git remote set-url origin "$BUNDLE_PATH"
fi

echo "--- Process Complete ---"