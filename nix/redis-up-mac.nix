{ lib
, redis
, writeShellApplication
, writeTextFile
}:

let
  # Use small script executed by bash to have a normal shell environment.
  redis-entrypoint = writeShellApplication {
    name = "redis-init";
    text = ''
      REDIS_CACHE_DIR=''${XDG_CACHE_HOME:-$HOME/Library/Caches}/Redis
      mkdir -p "$REDIS_CACHE_DIR"

      echo "View Redis Logs: tail -f $REDIS_CACHE_DIR/logs" >&2
      echo "Kill Redis server: pkill redis" >&2

      # 'exec' allows for us to replace bash process with MariaDB
      exec ${redis}/bin/redis-server \
        &> "$REDIS_CACHE_DIR"/logs
    '';
  };

# will create a shellchecked executable shell script located in $out/bin/<name>
# This shell script will be used to allow for impure+stateful actions
in writeShellApplication {
  name = "redis-up";
  text = ''
    # so use XDG conventions and hope $HOME doesn't have a space.
    REDIS_CACHE_DIR=''${XDG_CACHE_HOME:-$HOME/Library/Caches}/Redis
    REDIS_PIDFILE="$REDIS_CACHE_DIR"/redis.pid

    mkdir -p "$REDIS_CACHE_DIR"

    "${../scripts/start_comm_daemon.sh}" \
      redis \
      Redis \
      "${redis-entrypoint}/bin/redis-init" \
      "$REDIS_PIDFILE"

    # Explicitly exit this script so the parent shell can determine
    # when it's safe to return control of terminal to user
    exit 0
  '';
}
