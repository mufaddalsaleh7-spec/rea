/**
 * Right-hand panel dock. Groups mirror Illustrator's Essentials workspace:
 * Properties · Layers/Artboards · Color/Swatches/Gradient ·
 * Appearance/Transparency · Stroke · Align/Pathfinder/Transform ·
 * Character/Paragraph · Workspace · REA Analysis.
 */

import { app } from "../studio/app.js";
import { setUI, ui } from "../ui/overlays.js";
import { Btn, Icon, IconButton, Panel } from "./ui.jsx";
import {
  AlignPanel, AppearancePanel, ArtboardsPanel, CharacterPanel, ColorPanel, GradientPanel,
  LayersPanel, ParagraphPanel, PathfinderPanel, PropertiesPanel, ReaPanel, StrokePanel,
  SwatchesPanel, TransformPanel, TransparencyPanel, WorkspacePanel,
} from "./panels.jsx";

const GROUPS = [
  { id: "properties", tabs: [{ id: "properties", title: "Properties" }], render: () => <PropertiesPanel /> },
  {
    id: "layers",
    tabs: [
      { id: "layers", title: "Layers" },
      { id: "artboards", title: "Artboards" },
    ],
    render: (tab) => (tab.id === "artboards" ? <ArtboardsPanel /> : <LayersPanel />),
  },
  {
    id: "color",
    tabs: [
      { id: "color", title: "Color" },
      { id: "swatches", title: "Swatches" },
      { id: "gradient", title: "Gradient" },
    ],
    render: (tab) => {
      if (tab.id === "swatches") return <SwatchesPanel />;
      if (tab.id === "gradient") return <GradientPanel />;
      return <ColorPanel />;
    },
  },
  {
    id: "appearance",
    tabs: [
      { id: "appearance", title: "Appearance" },
      { id: "transparency", title: "Transparency" },
    ],
    render: (tab) => (tab.id === "transparency" ? <TransparencyPanel /> : <AppearancePanel />),
  },
  { id: "stroke", tabs: [{ id: "stroke", title: "Stroke" }], render: () => <StrokePanel /> },
  {
    id: "align",
    tabs: [
      { id: "align", title: "Align" },
      { id: "pathfinder", title: "Pathfinder" },
      { id: "transform", title: "Transform" },
    ],
    render: (tab) => {
      if (tab.id === "pathfinder") return <PathfinderPanel />;
      if (tab.id === "transform") return <TransformPanel />;
      return <AlignPanel />;
    },
  },
  {
    id: "type",
    tabs: [
      { id: "character", title: "Character" },
      { id: "paragraph", title: "Paragraph" },
    ],
    render: (tab) => (tab.id === "paragraph" ? <ParagraphPanel /> : <CharacterPanel />),
  },
  { id: "workspace", tabs: [{ id: "workspace", title: "Workspace" }], render: () => <WorkspacePanel /> },
  { id: "rea", tabs: [{ id: "rea", title: "REA Analysis" }], render: () => <ReaPanel /> },
];

export function Dock() {
  const collapsed = ui.panelsCollapsed;
  return (
    <aside
      className={`dock${app.dockCollapsed ? " is-collapsed" : ""}`}
      id="dock"
      aria-label="Panels"
      aria-hidden={app.dockCollapsed}
    >
      {GROUPS.map((group) => (
        <Panel
          key={group.id}
          group={group.id}
          tabs={group.tabs}
          collapsed={collapsed}
          onToggle={() => setUI({ panelsCollapsed: !collapsed })}
          actions={
            group.id === "properties" ? (
              <IconButton
                name="gear"
                title="Document setup"
                size={12}
                onClick={() => app.commands.documentSetup()}
              />
            ) : null
          }
        >
          {(tab) => group.render(tab)}
        </Panel>
      ))}
      <div className="dock__footer">
        <Btn small onClick={() => app.commands.exportDialog()}>
          <Icon name="hamburger" size={11} /> Export…
        </Btn>
        <Btn small onClick={() => app.commands.shortcuts()}>Shortcuts</Btn>
      </div>
    </aside>
  );
}
