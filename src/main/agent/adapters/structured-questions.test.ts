import { describe, expect, it } from 'vitest';

import { StructuredQuestionSchema } from '../../../shared/agent/contracts';
import { mcpFormContent, mcpFormQuestions } from './structured-questions';

const deployForm = {
  type: 'object',
  properties: {
    environment: {
      type: 'string',
      title: 'Environment',
      description: 'Where should this go?',
      oneOf: [
        { const: 'stg', title: 'Staging' },
        { const: 'prd', title: 'Production' }
      ]
    },
    replicas: { type: 'integer', title: 'Replicas' },
    notify: { type: 'boolean', title: 'Notify the team' },
    note: { type: 'string', description: 'Anything to add' },
    regions: { type: 'array', title: 'Regions', items: { enum: ['eu', 'us'] } }
  },
  required: ['environment', 'replicas']
};

describe('mcpFormQuestions', () => {
  it('turns each field of the form into a question the composer can show', () => {
    const form = mcpFormQuestions(deployForm);

    expect(form?.questions).toEqual([
      expect.objectContaining({
        id: 'field-0',
        header: 'Environment',
        prompt: 'Where should this go?',
        answer: 'choice',
        options: [
          { label: 'Staging', description: null },
          { label: 'Production', description: null }
        ],
        multiSelect: false,
        required: true
      }),
      expect.objectContaining({ id: 'field-1', header: 'Replicas', answer: 'number', required: true }),
      expect.objectContaining({ id: 'field-2', header: 'Notify the team', answer: 'boolean', required: false }),
      expect.objectContaining({ id: 'field-3', header: 'note', prompt: 'Anything to add', answer: 'text' }),
      expect.objectContaining({ id: 'field-4', answer: 'choice', multiSelect: true })
    ]);
    // Every question is one the contract accepts.
    for (const question of form!.questions) {
      expect(StructuredQuestionSchema.safeParse(question).success).toBe(true);
    }
  });

  it('declines a form it cannot show faithfully rather than half-answering it', () => {
    expect(mcpFormQuestions({
      type: 'object',
      properties: { address: { type: 'object', properties: {} } }
    })).toBeNull();
    expect(mcpFormQuestions({ type: 'object', properties: {} })).toBeNull();
    expect(mcpFormQuestions('not a form')).toBeNull();
  });
});

describe('mcpFormContent', () => {
  const form = mcpFormQuestions(deployForm)!;

  it('writes answers back typed the way the form declared them', () => {
    expect(mcpFormContent(form, {
      'field-0': ['Production'],
      'field-1': ['3'],
      'field-2': ['true'],
      'field-3': ['  ship it  '],
      'field-4': ['eu', 'us']
    })).toEqual({
      environment: 'prd',
      replicas: 3,
      notify: true,
      note: 'ship it',
      regions: ['eu', 'us']
    });
  });

  it('leaves out an optional field the user left empty', () => {
    expect(mcpFormContent(form, { 'field-0': ['Staging'], 'field-1': ['1'] }))
      .toEqual({ environment: 'stg', replicas: 1 });
  });

  it('refuses a missing required answer, a non-number, or a choice that was not offered', () => {
    expect(() => mcpFormContent(form, { 'field-1': ['1'] })).toThrow('environment needs an answer');
    expect(() => mcpFormContent(form, { 'field-0': ['Staging'], 'field-1': ['1.5'] }))
      .toThrow('replicas needs a number');
    expect(() => mcpFormContent(form, { 'field-0': ['Moon'], 'field-1': ['1'] }))
      .toThrow('environment has no such choice');
  });
});
