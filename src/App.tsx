import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import './styles/theme.css'
import './styles/app.css'

export default function App() {
  const [sidebarOpen] = useState(true)

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <Sidebar />
      <main className="editor-pane">
        <div className="editor-root">Editor will go here.</div>
      </main>
      <StatusBar />
    </div>
  )
}
