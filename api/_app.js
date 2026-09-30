// One store and one set of API handlers per warm Vercel function, shared by
// api/auth/* and api/projects/*. The store is created on first use so a
// missing Redis setup surfaces as a clear 503 rather than a crashed function.
'use strict';
const { createAppStore } = require('../server/app-store');
const { createAuthApi } = require('../server/auth-api');
const { createProjectApi } = require('../server/project-api');

let store = null;
const getStore = () => { if (!store) store = createAppStore(); return store; };

const auth = createAuthApi({ getStore });
const projects = createProjectApi({ getStore, auth });

module.exports = { getStore, auth, projects };
