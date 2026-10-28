import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui/spinner';
import { useMe } from './lib/queries';
import { BrainPage } from './pages/Brain';
import { FeedPage } from './pages/Feed';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { PeoplePage } from './pages/People';
import { PersonPage } from './pages/Person';
import { ReplyListPage } from './pages/ReplyList';
import { SyncsPage } from './pages/Syncs';
import { TeamPage } from './pages/Team';

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function App() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="grid h-dvh place-items-center text-ink-3">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // Animate between sections, not between filter changes inside one.
  const section = location.pathname.split('/').slice(0, 3).join('/');

  return (
    <Layout user={user}>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={section}>
          <Route path="/" element={<Page><OverviewPage /></Page>} />
          <Route path="/feed" element={<Page><FeedPage /></Page>} />
          <Route path="/list" element={<Page><ReplyListPage /></Page>} />
          <Route path="/people" element={<Page><PeoplePage /></Page>} />
          <Route path="/people/:id" element={<Page><PersonPage /></Page>} />
          <Route path="/syncs" element={<Page><SyncsPage /></Page>} />
          <Route path="/brain" element={user.role === 'admin' ? <Page><BrainPage /></Page> : <Navigate to="/" replace />} />
          <Route path="/team" element={user.role === 'admin' ? <Page><TeamPage /></Page> : <Navigate to="/" replace />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </Layout>
  );
}
