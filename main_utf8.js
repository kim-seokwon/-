// import { mockData, STAGES } from './mockData.js';

class BhasApp {
    constructor() {
        this.currentUser = null;
        this.appContainer = document.getElementById('app');
        this.currentView = 'login'; // 'login', 'dashboard', 'detail'
        this.activeProjectId = null;
        this.selectedDocCategory = '