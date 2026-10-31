import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HERMES_PYTHON = path.join(
  os.homedir(),
  ".hermes/cache/scratch/personal-clipper-venv/bin/python",
);

export function captionFontDir() {
  return process.env.PERSONAL_CLIPPER_FONT_DIR || "/usr/share/fonts/noto";
}

export function coverFont() {
  return (
    process.env.PERSONAL_CLIPPER_COVER_FONT ||
    path.join(/* turbopackIgnore: true */ captionFontDir(), "NotoSans-Black.ttf")
  );
}

export function clipperScriptsDir() {
  return (
    process.env.PERSONAL_CLIPPER_SCRIPTS_DIR ||
    path.join(/* turbopackIgnore: true */ process.cwd(), "scripts")
  );
}

export function clipperScript(name: string) {
  return path.join(/* turbopackIgnore: true */ clipperScriptsDir(), name);
}

export function clipperPython() {
  if (process.env.PERSONAL_CLIPPER_PYTHON) return process.env.PERSONAL_CLIPPER_PYTHON;
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), "python", "python.exe"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "python", "bin", "python3"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", "python", "python.exe"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", "python", "bin", "python3"),
  ];
  for (const bundled of candidates) {
    if (fs.existsSync(bundled)) return bundled;
  }
  return HERMES_PYTHON;
}

/** Env so relocatable CPython finds encodings even if AppRun set PYTHONHOME=/usr. */
export function pythonChildEnv(): Record<string, string> {
  const py = clipperPython();
  const home = path.resolve(/* turbopackIgnore: true */ path.dirname(py), "..");
  if (fs.existsSync(path.join(/* turbopackIgnore: true */ home, "pyvenv.cfg"))) return {};
  const encodings = path.join(/* turbopackIgnore: true */ home, "lib");
  if (!fs.existsSync(encodings)) return {};
  const hasStdlib = fs.readdirSync(encodings).some((d) => {
    return d.startsWith("python3") && fs.existsSync(path.join(encodings, d, "encodings"));
  });
  if (!hasStdlib) return {};
  const ld = process.env.LD_LIBRARY_PATH;
  return {
    PYTHONHOME: home,
    PYTHONNOUSERSITE: "1",
    LD_LIBRARY_PATH: ld ? `${encodings}${path.delimiter}${ld}` : encodings,
  };
}
