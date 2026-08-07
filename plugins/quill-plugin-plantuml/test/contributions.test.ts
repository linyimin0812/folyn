import { describe, it, expect } from 'vitest';
import module, { PlantUmlMarkdownBlock, PlantUmlContainerBlock, enhancePlantUml } from '../src/index';
import manifest from '../manifest.json';

// ponytail: assert manifest declares the four PR2 contributions and the
// PluginModule resolves each entry-ref to a function/component. Mirrors
// handler.test.ts style (manifest shape + entry-ref resolution).
describe('PR2 contributions', () => {
  it('manifest declares markdownCodeRenderers for plantuml + aliases', () => {
    expect(manifest.contributes?.markdownCodeRenderers?.[0]).toMatchObject({
      language: 'plantuml',
      aliases: ['puml', 'pu'],
      component: 'PlantUmlMarkdownBlock',
    });
  });

  it('manifest declares the plantuml container directive', () => {
    expect(manifest.contributes?.containers?.[0]).toMatchObject({
      name: 'plantuml',
      label: 'PlantUML',
      category: 'media',
      component: 'PlantUmlContainerBlock',
      template: ':::plantuml\n@startuml\nA -> B\n@enduml\n:::',
    });
  });

  it('manifest declares the export enhancer', () => {
    expect(manifest.contributes?.exportEnhancers?.[0]).toMatchObject({
      name: 'plantuml',
      run: 'enhancePlantUml',
    });
  });

  it('manifest declares the editor language', () => {
    expect(manifest.contributes?.editorLanguages?.[0]).toMatchObject({
      id: 'plantuml',
      aliases: ['puml', 'pu'],
      entry: 'plantumlLanguage',
    });
  });

  it('manifest grants http origin to plantuml.com', () => {
    expect(manifest.permissions?.http?.origins).toContain('https://www.plantuml.com');
  });
});

describe('PluginModule entry-ref resolution', () => {
  it('markdownCodeRenderers.PlantUmlMarkdownBlock is a component', () => {
    expect(typeof module.markdownCodeRenderers?.PlantUmlMarkdownBlock).toBe('function');
    expect(module.markdownCodeRenderers?.PlantUmlMarkdownBlock).toBe(PlantUmlMarkdownBlock);
  });

  it('containers.PlantUmlContainerBlock is a component', () => {
    expect(typeof module.containers?.PlantUmlContainerBlock).toBe('function');
    expect(module.containers?.PlantUmlContainerBlock).toBe(PlantUmlContainerBlock);
  });

  it('exportEnhancers.enhancePlantUml is a function', () => {
    expect(typeof module.exportEnhancers?.enhancePlantUml).toBe('function');
    expect(module.exportEnhancers?.enhancePlantUml).toBe(enhancePlantUml);
  });

  it('editorLanguages.plantumlLanguage is a factory returning a value', () => {
    const factory = module.editorLanguages?.plantumlLanguage;
    expect(typeof factory).toBe('function');
    const result = (factory as () => unknown)();
    expect(result).toBeDefined();
    // ponytail: memoized — second call returns the same instance.
    expect((factory as () => unknown)()).toBe(result);
  });
});
