declare module '@novnc/novnc' {
  interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  interface DisconnectDetail {
    clean: boolean;
  }
  interface SecurityFailureDetail {
    status: number;
    reason: string;
  }

  type RFBEventMap = {
    connect: Event;
    disconnect: CustomEvent<DisconnectDetail>;
    credentialsrequired: Event;
    securityfailure: CustomEvent<SecurityFailureDetail>;
    clipboard: CustomEvent<{ text: string }>;
    bell: Event;
    desktopname: CustomEvent<{ name: string }>;
    capabilities: CustomEvent<unknown>;
  };

  class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    viewOnly: boolean;
    focusOnClick: boolean;
    touchButton: number;
    clipViewport: boolean;
    dragViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;

    disconnect(): void;
    sendCredentials(creds: { username?: string; password?: string; target?: string }): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;

    addEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (ev: RFBEventMap[K]) => void,
    ): void;
    removeEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (ev: RFBEventMap[K]) => void,
    ): void;
  }

  export default RFB;
}
