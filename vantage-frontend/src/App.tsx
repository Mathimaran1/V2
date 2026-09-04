import { Route, Routes } from 'react-router-dom';
import Layout from '@/components/shared/Layout';
import DeveloperDetailPage from '@/pages/DeveloperDetail/DeveloperDetailPage';
import OverviewPage from '@/pages/Overview/OverviewPage';
import TicketDetailPage from '@/pages/TicketDetail/TicketDetailPage';
import UsersPage from '@/pages/Users/UsersPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/ticket/:ticketId" element={<TicketDetailPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:developerId" element={<DeveloperDetailPage />} />
      </Route>
    </Routes>
  );
}
