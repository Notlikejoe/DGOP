declare module 'bpmn-js/lib/Modeler' {
  export default class Modeler {
    constructor(options: Record<string, unknown>);
    importXML(xml: string): Promise<{ warnings?: unknown[] }>;
    saveXML(options?: Record<string, unknown>): Promise<{ xml: string }>;
    createDiagram(): Promise<void>;
    attachTo(container: HTMLElement): void;
    destroy(): void;
  }
}
