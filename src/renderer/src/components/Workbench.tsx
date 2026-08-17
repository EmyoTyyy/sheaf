import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useSettingsStore } from '../state/settings-store'
import { useUiStore } from '../state/ui-store'
import { BottomPanel } from './BottomPanel'
import { EditorPane } from './EditorPane'
import { PdfPane } from './PdfPane'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import './Workbench.css'

export function Workbench(): JSX.Element {
  const explorerVisible = useUiStore((state) => state.explorerVisible)
  const bottomVisible = useUiStore((state) => state.bottomVisible)
  const layout = useUiStore((state) => state.layout)
  const distractionFree = useUiStore((state) => state.distractionFree)
  const pdfPosition = useSettingsStore((state) => state.settings?.pdf.position ?? 'right')

  const showEditor = layout !== 'pdf'
  const showPdf = layout !== 'editor'
  const direction = pdfPosition === 'bottom' ? 'vertical' : 'horizontal'
  const pdfFirst = pdfPosition === 'left'

  const centre =
    showEditor && showPdf ? (
      <PanelGroup direction={direction} autoSaveId={`sheaf-centre-${direction}`}>
        {pdfFirst ? (
          <>
            <Panel id="pdf" order={1} defaultSize={50} minSize={20}>
              <PdfPane />
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel id="editor" order={2} defaultSize={50} minSize={20}>
              <EditorPane />
            </Panel>
          </>
        ) : (
          <>
            <Panel id="editor" order={1} defaultSize={50} minSize={20}>
              <EditorPane />
            </Panel>
            <PanelResizeHandle className="resize-handle" />
            <Panel id="pdf" order={2} defaultSize={50} minSize={20}>
              <PdfPane />
            </Panel>
          </>
        )}
      </PanelGroup>
    ) : showEditor ? (
      <EditorPane />
    ) : (
      <PdfPane />
    )

  return (
    <div className={`workbench${distractionFree ? ' workbench--zen' : ''}`}>
      {!distractionFree ? <Toolbar /> : null}

      <div className="workbench__main">
        <PanelGroup direction="horizontal" autoSaveId="sheaf-shell">
          {explorerVisible ? (
            <>
              <Panel id="sidebar" order={1} defaultSize={19} minSize={12} maxSize={44}>
                <Sidebar />
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          ) : null}

          <Panel id="content" order={2} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="sheaf-content">
              <Panel id="centre" order={1} minSize={25}>
                {centre}
              </Panel>
              {bottomVisible ? (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel id="bottom" order={2} defaultSize={26} minSize={8} maxSize={70}>
                    <BottomPanel />
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {!distractionFree ? <StatusBar /> : null}
    </div>
  )
}
