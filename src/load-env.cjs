"use strict";
/**
 * Load .env with override: true so the project file is the single source of truth.
 * Used as tsx preload (-r ./src/load-env.cjs); .env wins over shell vars.
 */
const path = require("path");
require("dotenv").config({ path: path.join(process.cwd(), ".env"), override: true });
