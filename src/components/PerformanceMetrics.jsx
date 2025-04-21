// Import necessary dependencies and remove unused imports
import React, { useState } from 'react'; // Remove useEffect since it's not used
import { Bar, Doughnut } from 'react-chartjs-2';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  BarElement, 
  Title, 
  Tooltip, 
  Legend,
  ArcElement
} from 'chart.js';
import './PerformanceMetrics.css';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

// Component for displaying RAG system performance metrics
const PerformanceMetrics = ({ metrics }) => {
  const [activeTab, setActiveTab] = useState('overview');

  if (!metrics) {
    return (
      <div className="performance-metrics">
        <div className="metrics-empty-state">
          <p>Belum ada data metrik yang tersedia.</p>
          <p>Gunakan sistem RAG terlebih dahulu untuk melihat metrik performa.</p>
        </div>
      </div>
    );
  }

  // Prepare citations data for chart
  const getCitationChartData = () => {
    // If there are no document citations, return placeholder data
    if (!metrics.documentCitations || Object.keys(metrics.documentCitations).length === 0) {
      return {
        labels: ['No Data'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e2e8f0'],
          borderWidth: 0
        }]
      };
    }
    
    // Sort citations by count (descending)
    const sortedCitations = Object.entries(metrics.documentCitations)
      .sort((a, b) => b[1] - a[1]);
    
    // Take top 5 for better visualization
    const topCitations = sortedCitations.slice(0, 5);
    
    // Format document names to be shorter
    const formatDocName = (name) => {
      if (name.length > 20) {
        return name.substring(0, 17) + '...';
      }
      return name;
    };
    
    return {
      labels: topCitations.map(([doc, _]) => formatDocName(doc)),
      datasets: [{
        label: 'Citations',
        data: topCitations.map(([_, count]) => count),
        backgroundColor: [
          '#8b5cf6', // Purple
          '#6366f1', // Indigo
          '#3b82f6', // Blue
          '#0ea5e9', // Light Blue
          '#06b6d4'  // Cyan
        ],
        borderWidth: 0
      }]
    };
  };
  
  // Prepare query types data for chart
  const getQueryTypesChartData = () => {
    const { queryTypes } = metrics;
    
    // Check if we have query type data
    if (!queryTypes || Object.values(queryTypes).every(v => v === 0)) {
      return {
        labels: ['No Data'],
        datasets: [{
          data: [1],
          backgroundColor: ['#e2e8f0'],
          borderWidth: 0
        }]
      };
    }
    
    return {
      labels: ['Math', 'Factual', 'General'],
      datasets: [{
        label: 'Query Types',
        data: [queryTypes.math, queryTypes.factual, queryTypes.general],
        backgroundColor: [
          '#6366f1',  // Indigo for math
          '#10b981',  // Emerald for factual
          '#f59e0b'   // Amber for general
        ],
        borderWidth: 0
      }]
    };
  };
  
  // Format milliseconds to seconds with 1 decimal place
  const formatResponseTime = (ms) => {
    return (ms / 1000).toFixed(1);
  };
  
  // Calculate success rate percentage
  const getSuccessRate = () => {
    if (metrics.queries === 0) return 0;
    return Math.round((metrics.successfulQueries / metrics.queries) * 100);
  };
  
  // Main overview metrics
  const renderOverviewTab = () => (
    <div className="metrics-overview">
      <div className="metrics-cards">
        <div className="metric-card">
          <div className="metric-value">{metrics.queries}</div>
          <div className="metric-label">Total Queries</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-value">{formatResponseTime(metrics.averageResponseTime)}s</div>
          <div className="metric-label">Avg Response Time</div>
        </div>
        
        <div className="metric-card">
          <div className="metric-value">{getSuccessRate()}%</div>
          <div className="metric-label">Success Rate</div>
        </div>
      </div>
      
      <div className="metrics-charts">
        <div className="chart-container">
          <h4>Citations by Document</h4>
          <Doughnut 
            data={getCitationChartData()}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: {
                    boxWidth: 12,
                    padding: 15
                  }
                }
              },
              cutout: '60%'
            }}
          />
        </div>
        
        <div className="chart-container">
          <h4>Query Types</h4>
          <Doughnut 
            data={getQueryTypesChartData()}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  position: 'bottom',
                  labels: {
                    boxWidth: 12,
                    padding: 15
                  }
                }
              },
              cutout: '60%'
            }}
          />
        </div>
      </div>
    </div>
  );
  
  // Detailed performance analysis
  const renderDetailedTab = () => {
    // Process the documents to create stats sorted by citation count
    const documentStats = Object.entries(metrics.documentCitations || {})
      .sort((a, b) => b[1] - a[1])
      .map(([doc, count]) => ({
        name: doc,
        count,
        percentage: metrics.queries > 0 
          ? Math.round((count / metrics.queries) * 100) 
          : 0
      }));
      
    // Don't use underscore as unused variable - use proper variable name
    const responseTimeLabels = ['Average', ...Array.from({ length: Math.min(5, metrics.queries) }, (_, index) => `Query ${metrics.queries - index}`).reverse()];
    
    return (
      <div className="metrics-detailed">
        <div className="detailed-section">
          <h4>Response Time Breakdown</h4>
          <p className="section-description">
            Average response time: <strong>{formatResponseTime(metrics.averageResponseTime)}s</strong>
          </p>
          
          <div className="response-time-chart">
            <Bar 
              data={{
                labels: responseTimeLabels,
                datasets: [{
                  label: 'Response Time (seconds)',
                  data: [metrics.averageResponseTime / 1000],
                  backgroundColor: '#6366f1',
                  borderRadius: 4
                }]
              }}
              options={{
                responsive: true,
                scales: {
                  y: {
                    beginAtZero: true,
                    title: {
                      display: true,
                      text: 'Seconds'
                    }
                  }
                },
                plugins: {
                  legend: {
                    display: false
                  }
                }
              }}
            />
          </div>
        </div>
        
        <div className="detailed-section">
          <h4>Document Citation Analysis</h4>
          <p className="section-description">
            Documents cited in responses and their frequency
          </p>
          
          <div className="document-citations-list">
            {documentStats.length > 0 ? (
              <table className="citations-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Citations</th>
                    <th>Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {documentStats.map((doc) => (
                    <tr key={doc.name}>
                      <td>{doc.name}</td>
                      <td>{doc.count}</td>
                      <td>{doc.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="no-data">No document citations recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="performance-metrics">
      <div className="metrics-header">
        <h3>RAG System Performance</h3>
        <div className="metrics-tabs">
          <button 
            className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button 
            className={`tab-button ${activeTab === 'detailed' ? 'active' : ''}`}
            onClick={() => setActiveTab('detailed')}
          >
            Detailed Analysis
          </button>
        </div>
      </div>
      
      <div className="metrics-content">
        {activeTab === 'overview' ? renderOverviewTab() : renderDetailedTab()}
      </div>
    </div>
  );
};

export default PerformanceMetrics;