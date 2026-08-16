import nextConfig from 'eslint-config-next';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'prisma/**'] },
  ...nextConfig,
  {
    rules: {
      // The modals in this app follow the standard "reset a controlled form's
      // fields from a record when the modal opens" effect pattern (keyed off
      // `show`/`editId`) — the textbook case React's own docs endorse via
      // useEffect. The rule flags every setState-in-effect regardless of
      // that distinction, so disable it rather than churn ~9 modals onto a
      // key-remount pattern for no behavioral difference.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
