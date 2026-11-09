import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { ReminderProvider } from './reminders'
import Layout from './components/Layout'
import { MODULES } from './modules'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import InboxPage from './pages/Inbox'
import TasksPage from './pages/Tasks'
import CalendarPage from './pages/Calendar'
import RemindersPage from './pages/Reminders'
import HabitsPage from './pages/Habits'
import ExpensesPage from './pages/Expenses'
import ReviewPage from './pages/Review'
import GenericPage from './pages/Generic'
import NoteDetail from './pages/NoteDetail'

function Gate() {
  const { authed } = useAuth()
  if (!authed) return <Login />
  return (
    <ReminderProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="notes/:id" element={<NoteDetail />} />
        {MODULES.map((m) => <Route key={m.route} path={m.route} element={<GenericPage key={m.route} m={m} />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </ReminderProvider>
  )
}

export default function App() {
  // HashRouter keeps the build static-host friendly (GitHub Pages, Tauri, Capacitor)
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
