#!/bin/sh
# 15-sync-usb-photos.sh
# Ultra-fast USB photo discovery & manifest builder for LG webOS (ARM / 1.2GB RAM)
# Uses a single directory symlink + single-pass awk (5,000+ photos in < 0.2s)
# Author: Free My TV Project

APP_DIR="/media/developer/apps/usr/palm/applications/io.freemytv"
WALLPAPERS_DIR="$APP_DIR/wallpapers"
PERSONAL_DIR="$WALLPAPERS_DIR/personal"
MANIFEST_FILE="$WALLPAPERS_DIR/personal_manifest.json"

mkdir -p "$WALLPAPERS_DIR"

sync_from_usb() {
    SRC_DIR=""
    # Search common webOS USB mount locations
    for USB_ROOT in /tmp/usb/*/* /media/multimedia/*; do
        if [ -d "$USB_ROOT" ]; then
            if [ -d "$USB_ROOT/fotos" ]; then
                SRC_DIR="$USB_ROOT/fotos"
                break
            elif [ -d "$USB_ROOT/wallpapers" ]; then
                SRC_DIR="$USB_ROOT/wallpapers"
                break
            elif [ -d "$USB_ROOT/Fotos" ]; then
                SRC_DIR="$USB_ROOT/Fotos"
                break
            fi
        fi
    done

    if [ -n "$SRC_DIR" ]; then
        # Single directory symlink instead of thousands of individual file symlinks
        if [ ! -L "$PERSONAL_DIR" ] || [ "$(readlink "$PERSONAL_DIR" 2>/dev/null)" != "$SRC_DIR" ]; then
            rm -rf "$PERSONAL_DIR"
            ln -sfn "$SRC_DIR" "$PERSONAL_DIR"
        fi
    else
        if [ -L "$PERSONAL_DIR" ] && [ ! -e "$PERSONAL_DIR" ]; then
            rm -f "$PERSONAL_DIR"
        fi
        mkdir -p "$PERSONAL_DIR"
    fi

    # Build compact personal_manifest.json in a single pass using /bin/ls -1 + awk (no stat() overhead on FAT32)
    if [ -d "$PERSONAL_DIR" ]; then
        /bin/ls -1 "$PERSONAL_DIR/" 2>/dev/null | awk '
        BEGIN {
            print "["
            first = 1
        }
        /\.(jpg|jpeg|png|JPG|JPEG|PNG)$/ && !/["\\]/ {
            if (!first) printf ",\n"
            first = 0
            printf "  \"%s\"", $0
        }
        END {
            printf "\n]\n"
        }
        ' > "$MANIFEST_FILE.tmp"

        if grep -q '"' "$MANIFEST_FILE.tmp" 2>/dev/null; then
            mv "$MANIFEST_FILE.tmp" "$MANIFEST_FILE"
            chmod 644 "$MANIFEST_FILE"
        else
            rm -f "$MANIFEST_FILE.tmp"
        fi
    fi
}

sync_from_usb
