export type FieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'color';

export interface FieldConfig {
  key: string;
  labelKey: string;
  type: FieldType;
  required?: boolean;
  /** Static options for a select. */
  options?: { value: string; label: string }[];
  /** Load select options from a REST base returning {id,nameEn,nameAr}. */
  optionsFrom?: string;
}

export type ColumnKind = 'text' | 'boolean' | 'color' | 'ref' | 'i18nName';

export interface ColumnConfig {
  key: string;
  labelKey: string;
  kind?: ColumnKind;
  /** For kind 'ref': property holding a {nameEn,nameAr} object. */
  refKey?: string;
}

export interface MasterDataConfig {
  titleKey: string;
  subtitleKey: string;
  apiBase: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
}
