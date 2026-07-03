import { describe, it, expect } from 'vitest';
import { parseDbml } from './parseDbml';

describe('parseDbml', () => {
  it('parses tables and inline refs with correct cardinality', async () => {
    const src = `Table users {
  id integer [pk, increment]
  name varchar [not null]
}
Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
}`;
    const { schema, errors } = await parseDbml(src);
    expect(errors).toEqual([]);
    expect(schema?.tables).toHaveLength(2);
    expect(schema?.tables[0].fields[0]).toMatchObject({
      name: 'id',
      pk: true,
      increment: true,
    });
    expect(schema?.refs).toHaveLength(1);
    const ref = schema!.refs[0];
    expect(ref.fromTable).toBe('users');
    expect(ref.toTable).toBe('orders');
    // '>' means users.id is the '1' side, orders.user_id is the '*' side
    expect(ref.cardinality).toBe('1:*');
  });

  it('parses explicit many-to-many ref (<> operator)', async () => {
    const src = `Table students {
  id int [pk]
}
Table courses {
  id int [pk]
}
Ref: students.id <> courses.id`;
    const { schema, errors } = await parseDbml(src);
    expect(errors).toEqual([]);
    expect(schema?.refs[0].cardinality).toBe('*:*');
  });

  it('formats column type with args', async () => {
    const src = `Table t {
  name varchar(255) [not null]
}`;
    const { schema, errors } = await parseDbml(src);
    expect(errors).toEqual([]);
    expect(schema?.tables[0].fields[0].type).toBe('varchar(255)');
    expect(schema?.tables[0].fields[0].notNull).toBe(true);
  });

  it('returns friendly errors for invalid DBML', async () => {
    const src = `Table t {
  id int [pk
}`; // unterminated bracket
    const { schema, errors } = await parseDbml(src);
    expect(schema).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBeGreaterThan(0);
    expect(typeof errors[0].message).toBe('string');
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

  it('returns an empty schema for blank input', async () => {
    const { schema, errors } = await parseDbml('   \n  ');
    expect(errors).toEqual([]);
    expect(schema?.tables).toEqual([]);
    expect(schema?.refs).toEqual([]);
  });

  it('passes through [headercolor: #hex] from DBML syntax', async () => {
    const src = `Table users [headercolor: #f0f0f0] {
  id integer [pk]
}`;
    const { schema, errors } = await parseDbml(src);
    expect(errors).toEqual([]);
    expect(schema?.tables[0].headerColor?.toLowerCase()).toBe('#f0f0f0');
  });

  it('leaves headerColor undefined when not specified', async () => {
    const src = `Table users {
  id integer [pk]
}`;
    const { schema, errors } = await parseDbml(src);
    expect(errors).toEqual([]);
    expect(schema?.tables[0].headerColor).toBeUndefined();
  });
});
