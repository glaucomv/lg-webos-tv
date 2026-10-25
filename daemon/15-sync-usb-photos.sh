#!/bin/sh
# 15-sync-usb-photos.sh
# Automount and discovery of personal photos from USB pendrives on LG webOS
# Author: Free My TV Project

APP_DIR="/media/developer/apps/usr/palm/applications/io.freemytv"
WALLPAPERS_DIR="$APP_DIR/wallpapers"
PERSONAL_DIR="$WALLPAPERS_DIR/personal"
MANIFEST_FILE="$WALLPAPERS_DIR/personal_manifest.json"

mkdir -p "$PERSONAL_DIR"

sync_from_usb() {
    FOUND=0
    # Search common webOS mount locations
    for USB_ROOT in /tmp/usb/*/* /media/multimedia/*; do
        if [ -d "$USB_ROOT" ]; then
            # Check for dedicated folder 'fotos' or 'wallpapers', else check USB root
            SRC_DIR=""
            if [ -d "$USB_ROOT/fotos" ]; then
                SRC_DIR="$USB_ROOT/fotos"
            elif [ -d "$USB_ROOT/wallpapers" ]; then
                SRC_DIR="$USB_ROOT/wallpapers"
            elif [ -d "$USB_ROOT/Fotos" ]; then
                SRC_DIR="$USB_ROOT/Fotos"
            fi

            if [ -n "$SRC_DIR" ]; then
                # Link or sync photos
                for f in "$SRC_DIR"/*.jpg "$SRC_DIR"/*.jpeg "$SRC_DIR"/*.png "$SRC_DIR"/*.JPG "$SRC_DIR"/*.JPEG "$SRC_DIR"/*.PNG; do
                    if [ -f "$f" ]; then
                        bname=$(basename "$f")
                        ln -sf "$f" "$PERSONAL_DIR/$bname" 2>/dev/null || cp "$f" "$PERSONAL_DIR/$bname" 2>/dev/null
                        FOUND=1
                    fi
                done
            fi
        fi
    done

    # If photos found, rebuild personal_manifest.json
    if [ "$FOUND" -eq 1 ] || [ -d "$PERSONAL_DIR" ]; then
        echo "[" > "$MANIFEST_FILE.tmp"
        FIRST=1
        for img in "$PERSONAL_DIR"/*; do
            if [ -f "$img" ]; then
                bname=$(basename "$img")
                title=$(echo "$bname" | sed 's/\.[^.]*$//' | tr '_' ' ')
                if [ "$FIRST" -eq 1 ]; then
                    FIRST=0
                else
                    echo "," >> "$MANIFEST_FILE.tmp"
                fi
                echo "  {\"url\": \"wallpapers/personal/$bname\", \"title\": \"$title (Pendrive)\"}" >> "$MANIFEST_FILE.tmp"
            fi
        done
        echo "]" >> "$MANIFEST_FILE.tmp"
        
        # Only replace manifest if photos exist
        if [ "$FIRST" -eq 0 ]; then
            mv "$MANIFEST_FILE.tmp" "$MANIFEST_FILE"
            chmod 644 "$MANIFEST_FILE"
        else
            rm -f "$MANIFEST_FILE.tmp"
        fi
    fi
}

sync_from_usb
