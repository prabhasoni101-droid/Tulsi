import React from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import OwnerDashboard from './dashboards/OwnerDashboard';
import MentorDashboard from './dashboards/MentorDashboard';
import UserDashboard from './dashboards/UserDashboard';

const Dashboard = () => {
  const { profile } = useAuth();

  const renderDashboard = () => {
    switch (profile?.role) {
      case 'OWNER':
        return <OwnerDashboard />;
      case 'MENTOR':
        return <MentorDashboard />;
      default:
        return <UserDashboard />;
    }
  };

  return (
    <Layout>
      {renderDashboard()}
    </Layout>
  );
};

export default Dashboard;
