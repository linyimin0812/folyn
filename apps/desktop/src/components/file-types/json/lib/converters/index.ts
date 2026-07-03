/**
 * Converter dispatcher.
 *
 * `listConverters()` returns the static catalog of available converters,
 * grouped for the ConvertPanel UI. `runConverter(id, value)` executes the
 * converter and returns its output + optional filename (for Excel
 * downloads, which the panel writes via Tauri `fs.writeFile`).
 *
 * Pure-string converters (YAML/XML/Base64/Escaped/Language) return
 * `{ output: string }`. Excel converters return `{ output: '', filename,
 * blob }` so the panel can offer a download instead of dumping binary
 * into a `<pre>`.
 */
import { toYaml } from './toYaml';
import { toXml } from './toXml';
import { toBase64 } from './toBase64';
import { toEscaped } from './toEscaped';
import {
  toExcelSingleHeader,
  toExcelMultiHeader,
} from './toExcel';
import { LANGUAGE_EMITTERS, type Lang } from './toLanguage';

export type ConverterGroup = 'output' | 'excel' | 'language';

export interface ConverterDef {
  id: string;
  label: string;
  group: ConverterGroup;
}

const CONVERTERS: ConverterDef[] = [
  { id: 'yaml', label: 'YAML', group: 'output' },
  { id: 'xml', label: 'XML', group: 'output' },
  { id: 'base64', label: 'Base64', group: 'output' },
  { id: 'escaped', label: 'Escaped', group: 'output' },
  { id: 'excel-single', label: 'Excel (单行表头)', group: 'excel' },
  { id: 'excel-multi', label: 'Excel (多行表头)', group: 'excel' },
  { id: 'lang-python', label: 'Python', group: 'language' },
  { id: 'lang-go', label: 'Go', group: 'language' },
  { id: 'lang-rust', label: 'Rust', group: 'language' },
  { id: 'lang-java', label: 'Java', group: 'language' },
  { id: 'lang-php', label: 'PHP', group: 'language' },
  { id: 'lang-csharp', label: 'C#', group: 'language' },
];

export function listConverters(): ConverterDef[] {
  return CONVERTERS;
}

export interface ConverterResult {
  output: string;
  mime?: string;
  filename?: string;
  blob?: Blob;
}

export async function runConverter(
  id: string,
  value: unknown,
): Promise<ConverterResult> {
  switch (id) {
    case 'yaml':
      return { output: await toYaml(value) };
    case 'xml':
      return { output: await toXml(value) };
    case 'base64':
      return { output: toBase64(value) };
    case 'escaped':
      return { output: toEscaped(value) };
    case 'excel-single': {
      const blob = await toExcelSingleHeader(value);
      return { output: '(二进制 .xlsx)', filename: 'data.xlsx', blob };
    }
    case 'excel-multi': {
      const blob = await toExcelMultiHeader(value);
      return { output: '(二进制 .xlsx)', filename: 'data.xlsx', blob };
    }
    case 'lang-python':
      return { output: LANGUAGE_EMITTERS.python(value) };
    case 'lang-go':
      return { output: LANGUAGE_EMITTERS.go(value) };
    case 'lang-rust':
      return { output: LANGUAGE_EMITTERS.rust(value) };
    case 'lang-java':
      return { output: LANGUAGE_EMITTERS.java(value) };
    case 'lang-php':
      return { output: LANGUAGE_EMITTERS.php(value) };
    case 'lang-csharp':
      return { output: LANGUAGE_EMITTERS.csharp(value) };
    default: {
      throw new Error(`unknown converter: ${id}`);
    }
  }
}

export type { Lang };
