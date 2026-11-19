#!/usr/bin/env bash
# SHAVI Code sandbox launcher.
#
# Called *inside* `unshare -r -m -n -p -f` by shavi-code/service.mjs. Builds a minimal
# root that contains only the language runtimes, an empty /tmp, a fresh /proc and the
# session's /mnt/data, then chroots into it and runs the user's command.
#
# Isolation this provides:
#   - new user namespace: uid 0 inside maps to the unprivileged host user, so nothing
#     inside can touch host-owned files or gain real privileges;
#   - new mount namespace: the host filesystem is not mounted here at all, so paths
#     like /workspace/... do not exist (verified by the M10 test suite);
#   - new network namespace: only a down loopback interface, so no outbound traffic;
#   - new pid namespace + fresh /proc: the program cannot see or signal host processes.
set -euo pipefail

WORK="$1"
shift
ROOT="$WORK/root"

mkdir -p "$ROOT"/{usr,lib,lib64,bin,sbin,etc,tmp,proc,dev,mnt/data,home/sandbox,opt,var}

for dir in /usr /lib /lib64 /bin /sbin /etc /opt /var; do
  [ -e "$dir" ] || continue
  mkdir -p "$ROOT$dir"
  mount --bind "$dir" "$ROOT$dir"
done

mount -t proc proc "$ROOT/proc"
mount -t tmpfs -o size=64m,nosuid,nodev tmpfs "$ROOT/tmp"
mount --bind "$WORK/data" "$ROOT/mnt/data"
chmod 0777 "$ROOT/tmp"
chmod 0777 "$WORK/data"

# /dev is a devtmpfs on the host and cannot be re-bound here; bind just the devices a
# normal program expects so reads of /dev/null and /dev/urandom keep working.
mount -t tmpfs -o size=1m,nosuid tmpfs "$ROOT/dev"
for dev in null zero urandom random; do
  : > "$ROOT/dev/$dev"
  mount --bind "/dev/$dev" "$ROOT/dev/$dev"
done
mkdir -p "$ROOT/dev/shm" "$ROOT/dev/fd"
mount -t tmpfs -o size=32m,nosuid,nodev tmpfs "$ROOT/dev/shm"

exec /usr/sbin/chroot "$ROOT" /usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME=/home/sandbox \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  PYTHONDONTWRITEBYTECODE=1 \
  MPLBACKEND=Agg \
  TMPDIR=/tmp \
  "$@"
