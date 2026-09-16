import { describe, expect, it } from 'vitest';
import * as api from '../index.js';

describe('public API', () => {
  it('exports the M1 entry points', () => {
    for (const name of [
      'inchesToEmu', 'canonicalJSON', 'sha256Hex', 'newId', 'deterministicId', 'positionBetween', 'TemplateJSON', 'DocumentJSON',
      'resolveStyle', 'validateTemplate', 'enterAction', 'BUILTIN_TEMPLATES', 'getBuiltinTemplate', 'localizeTemplate', 'createDocument',
      'documentToJSON', 'materializeDocument', 'applyTemplate', 'exportTemplate', 'migrateDocument', 'DOC_SCHEMA_VERSION', 'validateDocument',
      'openDocument', 'parseSceneHeading', 'elementContentHash', 'sceneContentHash', 'registerBuiltinCommands', 'executeBatch',
      'executeCommand', 'createSessionOrigins', 'createSessionUndo', 'harvest', 'normalizeKey',
    ]) expect(api, name).toHaveProperty(name);
  });
  it('declares each closed vocabulary once', () => {
    expect(api.ENTITY_KINDS).toHaveLength(26);
    expect(api.STYLE_ROLES).toHaveLength(27);
    expect(api.DOC_TOP_LEVEL_KEYS).toHaveLength(30);
    expect(api.NUMBER_MODES).toEqual(['1AB', '1A2', 'AB2', 'BA2', 'romanUpper', 'romanLower']);
  });
});
