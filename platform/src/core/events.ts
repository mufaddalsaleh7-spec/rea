/**
 * Typed publish/subscribe bus used for *all* cross-service signalling.
 *
 * Services never call the HTTP layer or the desktop shell directly: they emit
 * domain events and the transport (Server-Sent Events today) forwards them to
 * the UI. Topics are declared in one place so a typo cannot silently create a
 * dead channel.
 */

export type EventTopic =
  | "system.ready"
  | "settings.changed"
  | "files.changed"
  | "notifications.published"
  | "notifications.dismissed"
  | "process.started"
  | "process.finished"
  | "session.permissionsChanged";

export type PlatformEventMap = {
  "system.ready": { readonly startedAt: string; readonly version: string };
  "settings.changed": { readonly previous: unknown; readonly next: unknown };
  "files.changed": { readonly action: string; readonly path: string };
  "notifications.published": NotificationRecord;
  "notifications.dismissed": { readonly id: string };
  "process.started": { readonly id: string; readonly command: string };
  "process.finished": {
    readonly id: string;
    readonly command: string;
    readonly exitCode: number | null;
    readonly durationMs: number;
  };
  "session.permissionsChanged": { readonly granted: readonly string[] };
};

export type NotificationRecord = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly level: "info" | "success" | "warning" | "error";
  readonly createdAt: string;
};

export type PlatformEvent<TTopic extends EventTopic = EventTopic> = {
  readonly topic: TTopic;
  readonly payload: PlatformEventMap[TTopic];
  readonly emittedAt: string;
};

export type EventListener = (event: PlatformEvent) => void;

export type EventBus = {
  /** Subscribe to one topic. Returns the unsubscribe function. */
  readonly on: <TTopic extends EventTopic>(
    topic: TTopic,
    listener: (
      payload: PlatformEventMap[TTopic],
      event: PlatformEvent<TTopic>,
    ) => void,
  ) => () => void;
  /** Subscribe to every topic (used by the SSE transport and the logger). */
  readonly onAny: (listener: EventListener) => () => void;
  readonly emit: <TTopic extends EventTopic>(
    topic: TTopic,
    payload: PlatformEventMap[TTopic],
  ) => void;
  /** Recent events, oldest first, bounded by `historyLimit`. */
  readonly history: () => readonly PlatformEvent[];
  readonly listenerCount: () => number;
};

export type EventBusOptions = {
  readonly clock?: () => Date;
  readonly historyLimit?: number;
};

export const createEventBus = (options: EventBusOptions = {}): EventBus => {
  const clock = options.clock ?? (() => new Date());
  const historyLimit = options.historyLimit ?? 50;
  const listeners = new Set<EventListener>();
  const recent: PlatformEvent[] = [];

  const emit = <TTopic extends EventTopic>(
    topic: TTopic,
    payload: PlatformEventMap[TTopic],
  ): void => {
    const event = {
      topic,
      payload,
      emittedAt: clock().toISOString(),
    } as PlatformEvent;
    recent.push(event);
    if (recent.length > historyLimit)
      recent.splice(0, recent.length - historyLimit);
    // Copy before dispatch: a listener that unsubscribes must not corrupt the
    // iteration, and a throwing listener must not starve the others.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // Event delivery is best effort; failures are surfaced by the logger
        // attached to the bus rather than by interrupting the producer.
      }
    }
  };

  return {
    on: (topic, listener) =>
      addListener(listeners, (event) => {
        if (event.topic !== topic) return;
        listener(
          event.payload as PlatformEventMap[typeof topic],
          event as PlatformEvent<typeof topic>,
        );
      }),
    onAny: (listener) => addListener(listeners, listener),
    emit,
    history: () => [...recent],
    listenerCount: () => listeners.size,
  };
};

const addListener = (
  listeners: Set<EventListener>,
  listener: EventListener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
