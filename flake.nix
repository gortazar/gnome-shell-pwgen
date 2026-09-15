{
  description = "Password Generator — GNOME Shell extension generating passwords in-process";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        uuid = "pwgen-generator@pwgen-gs.patxi";

        # The file set an upload zip must contain: sources at the zip root, schemas
        # compiled alongside their XML. Kept in step with ci/lint-package.sh, which lints
        # this same layout.
        #
        # `gnome-extensions pack` would assemble this, but it ships with gnome-shell —
        # about a gigabyte of closure to download for one CLI invocation, in a check that
        # otherwise needs no compositor at all. This does the same assembly and asserts the
        # same things the tool would refuse on.
        packExtension = pkgs.writeShellApplication {
          name = "pwgen-pack";
          # glib-compile-schemas lives in glib's `dev` output, and runtimeInputs only puts
          # the default output on PATH.
          runtimeInputs = [ pkgs.glib.dev pkgs.zip pkgs.jq ];
          text = ''
            src="$1"
            outDir="$2"
            stage="$(mktemp -d)"
            trap 'rm -rf "$stage"' EXIT

            # gnome-extensions pack refuses a metadata.json missing any of these, and so
            # does extensions.gnome.org.
            for field in uuid name description shell-version url; do
              jq -e --arg f "$field" \
                'has($f) and (.[$f] | if type == "array" then length > 0 else . != "" end)' \
                "$src/metadata.json" >/dev/null \
                || { echo "metadata.json: missing or empty \"$field\"" >&2; exit 1; }
            done
            jq -e --arg u '${uuid}' '.uuid == $u' "$src/metadata.json" >/dev/null \
              || { echo "metadata.json: uuid is not ${uuid}" >&2; exit 1; }

            mkdir -p "$stage/schemas" "$stage/lib"
            cp "$src/metadata.json" "$src/extension.js" "$src/prefs.js" \
              "$src/LICENSE" "$stage/"
            cp "$src"/lib/*.js "$stage/lib/"
            cp "$src"/schemas/*.gschema.xml "$stage/schemas/"
            [ -f "$src/stylesheet.css" ] && cp "$src/stylesheet.css" "$stage/"
            [ -d "$src/locale" ] && cp -r "$src/locale" "$stage/"
            # Sources copied out of the nix store arrive read-only, directories included,
            # which leaves the staging area impossible to clean up on the way out.
            chmod -R u+w "$stage"

            # The shell reads the compiled file, so a schema that will not compile has to
            # fail here rather than at install time.
            glib-compile-schemas --strict "$stage/schemas"

            mkdir -p "$outDir"
            ( cd "$stage" && zip -qr "$outDir/${uuid}.shell-extension.zip" . )
            echo "packed $outDir/${uuid}.shell-extension.zip"
          '';
        };
      in {
        # `nix develop` — everything needed to work on this extension.
        #
        # ESLint is deliberately not a nix package here: the extension pins its own version
        # in package.json (flat config, ESLint 9), so use the nodejs from this shell and
        # `npm ci` to get exactly the version CI runs.
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.gjs # runs the headless test suite
            pkgs.glib.dev # glib-compile-schemas
            pkgs.nodejs_22 # npm ci && npx eslint
            pkgs.python3 # shexli, the EGO package linter
            pkgs.zip
            pkgs.unzip
            pkgs.jq
            pkgs.git
            packExtension
          ];

          shellHook = ''
            echo "pwgen dev shell"
            echo "  gjs -m tests/run.js       headless generator suite against the working tree"
            echo "  npm ci && npx eslint .    lint, the same version CI runs"
            echo "  nix flake check           suite + schema + pack, against git HEAD"
            echo "  nix build                 packed .shell-extension.zip"
            echo "  scripts/install-local.sh  symlink this checkout into a real shell"
          '';
        };

        # `nix flake check` — against the committed tree (`self` is the git-tracked file
        # set), so it says exactly what the recorded revision does.
        checks = {
          # The generator is a shell-free module, so the whole suite runs under plain gjs:
          # no display, no compositor.
          unit-tests = pkgs.runCommand "pwgen-unit-tests"
            {
              src = self;
              nativeBuildInputs = [ pkgs.gjs ];
            } ''
            cp -r "$src" ./source
            chmod -R u+w ./source
            cd ./source
            gjs -m tests/run.js | tee "$out"
          '';

          # A schema the shell cannot compile means preferences fail to open, and --strict
          # turns EGO-relevant warnings into errors.
          schemas = pkgs.runCommand "pwgen-schemas"
            {
              src = self;
              nativeBuildInputs = [ pkgs.glib ];
            } ''
            glib-compile-schemas --strict --dry-run "$src/schemas"
            echo "schemas OK" > "$out"
          '';

          # Packaging mistakes are publish blockers, so treat one as a test failure: an
          # incomplete zip is how a working extension still ends up broken for everyone who
          # installs it.
          pack = pkgs.runCommand "pwgen-pack"
            {
              src = self;
              nativeBuildInputs = [ packExtension pkgs.unzip ];
            } ''
            pwgen-pack "$src" "$PWD/out"
            zip="$PWD/out/${uuid}.shell-extension.zip"

            # Listed once into a variable, and searched without a pipeline. `unzip -l |
            # grep -q` looks equivalent and is not: grep exits at the first match, unzip
            # dies of SIGPIPE, and with pipefail the check fails at random depending on
            # which of them the scheduler ran first.
            listing="$(unzip -l "$zip")"
            echo "$listing"
            # The zip is what users actually get. The generator living in a subdirectory
            # makes it the easy thing to leave out, and the extension does not load
            # without it.
            for entry in metadata.json extension.js prefs.js LICENSE lib/generator.js \
                schemas/gschemas.compiled; do
              grep -q " $entry\$" <<< "$listing" \
                || { echo "packed zip is missing $entry" >&2; exit 1; }
            done
            echo "pack OK" > "$out"
          '';
        };

        # `nix build` — the uploadable artifact, and what the release workflow publishes.
        packages.default = pkgs.runCommand "pwgen-shell-extension"
          {
            src = self;
            nativeBuildInputs = [ packExtension ];
          } ''
          pwgen-pack "$src" "$out"
        '';

        # `nix run .#tests` — the same suite against the working tree, which is what you
        # want while editing. Impure on purpose: it reads the checkout, not a store path.
        apps.tests = {
          type = "app";
          meta.description = "Run the headless generator suite against the working tree";
          program = "${pkgs.writeShellApplication {
            name = "pwgen-tests";
            runtimeInputs = [ pkgs.gjs ];
            text = ''
              cd "''${1:-.}"
              exec gjs -m tests/run.js
            '';
          }}/bin/pwgen-tests";
        };
      });
}
