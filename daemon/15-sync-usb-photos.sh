#!/bin/sh
# 15-sync-usb-photos.sh
# Ultra-fast USB photo discovery & manifest builder for LG webOS (ARM / 1.2GB RAM)
# Uses a single directory symlink + persistent USB cache (.personal_manifest.json)
# Author: Free My TV Project

APP_DIR="/media/developer/apps/usr/palm/applications/io.freemytv"
WALLPAPERS_DIR="$APP_DIR/wallpapers"
PERSONAL_DIR="$WALLPAPERS_DIR/personal"
MANIFEST_FILE="$WALLPAPERS_DIR/personal_manifest.json"
CUSTOM_SRC_CFG="/var/lib/webosbrew/usb_photos_dir"
FORCE_RESCAN=0

if [ "$1" = "--rescan" ] || [ "$1" = "-f" ]; then
    FORCE_RESCAN=1
fi

mkdir -p "$WALLPAPERS_DIR"

sync_from_usb() {
    SRC_DIR=""

    # 1. Check user-selected USB folder first
    if [ -f "$CUSTOM_SRC_CFG" ]; then
        CFG_DIR=$(head -n 1 "$CUSTOM_SRC_CFG" 2>/dev/null | tr -d '\r\n')
        case "$CFG_DIR" in
            /tmp/usb/*|/media/multimedia/*)
                if [ -d "$CFG_DIR" ]; then
                    SRC_DIR="$CFG_DIR"
                fi
                ;;
        esac
    fi

    # 2. Automatic discovery on connected USB drives
    if [ -z "$SRC_DIR" ]; then
        for USB_ROOT in /tmp/usb/*/* /media/multimedia/*; do
            if [ -d "$USB_ROOT" ]; then
                if [ -d "$USB_ROOT/fotos" ]; then
                    SRC_DIR="$USB_ROOT/fotos"
                    break
                elif [ -d "$USB_ROOT/Fotos" ]; then
                    SRC_DIR="$USB_ROOT/Fotos"
                    break
                elif [ -d "$USB_ROOT/wallpapers" ]; then
                    SRC_DIR="$USB_ROOT/wallpapers"
                    break
                elif [ -d "$USB_ROOT/DCIM" ]; then
                    SRC_DIR="$USB_ROOT/DCIM"
                    break
                fi
            fi
        done
    fi

    if [ -n "$SRC_DIR" ]; then
        # Single directory symlink instead of thousands of individual file symlinks
        if [ ! -L "$PERSONAL_DIR" ] || [ "$(readlink "$PERSONAL_DIR" 2>/dev/null)" != "$SRC_DIR" ]; then
            rm -rf "$PERSONAL_DIR"
            ln -sfn "$SRC_DIR" "$PERSONAL_DIR"
        fi

        USB_CACHE="$SRC_DIR/.personal_manifest.json"

        # Fast path (< 0.01s): restore cached manifest directly from USB pendrive
        if [ "$FORCE_RESCAN" -eq 0 ] && [ -s "$USB_CACHE" ] && grep -q '"' "$USB_CACHE" 2>/dev/null; then
            cp "$USB_CACHE" "$MANIFEST_FILE.tmp" && mv "$MANIFEST_FILE.tmp" "$MANIFEST_FILE"
            chmod 644 "$MANIFEST_FILE"
            return 0
        fi

        # Full scan path: build compact manifest and persist on USB pendrive
        /bin/ls -1 "$PERSONAL_DIR/" 2>/dev/null | awk '
        BEGIN {
            print "["
            first = 1
        }
        /\.(jpg|jpeg|png|JPG|JPEG|PNG)$/ && !/^\./ && !/["\\]/ {
            if (!first) printf ",\n"
            first = 0
            printf "  \"%s\"", $0
        }
        END {
            printf "\n]\n"
        }
        ' > "$MANIFEST_FILE.tmp"

        if grep -q '"' "$MANIFEST_FILE.tmp" 2>/dev/null; then
            cp "$MANIFEST_FILE.tmp" "$USB_CACHE" 2>/dev/null || true
            mv "$MANIFEST_FILE.tmp" "$MANIFEST_FILE"
            chmod 644 "$MANIFEST_FILE"
        else
            rm -f "$MANIFEST_FILE.tmp"
        fi
    else
        if [ -L "$PERSONAL_DIR" ] && [ ! -e "$PERSONAL_DIR" ]; then
            rm -f "$PERSONAL_DIR"
        fi
    fi
}

sync_from_usb
