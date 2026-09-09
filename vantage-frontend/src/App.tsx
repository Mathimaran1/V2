import { Route, Routes } from 'react-router-dom';
import Layout from '@/components/shared/Layout';
import DeveloperDetailPage from '@/pages/DeveloperDetail/DeveloperDetailPage';
import JiraCallbackPage from '@/pages/Auth/JiraCallbackPage';
import OverviewPage from '@/pages/Overview/OverviewPage';
import TicketDetailPage from '@/pages/TicketDetail/TicketDetailPage';
import UsersPage from '@/pages/Users/UsersPage';

export default function App() {
  return (
    <Routes>
      {/* No Layout — this is a transient redirect target, not a real page */}
      <Route path="/auth/jira/callback" element={<JiraCallbackPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/ticket/:ticketId" element={<TicketDetailPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:developerId" element={<DeveloperDetailPage />} />
      </Route>
    </Routes>
  );
}
