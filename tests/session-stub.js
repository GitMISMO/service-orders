// Stands in for resources.mismo.org/assets/session.js (the shared sign-in) during the checks.
// It only reads the pretend session the harness puts in localStorage; nothing real is used.
(function () {
  function cur() { try { return JSON.parse(localStorage.getItem('resources:session') || 'null'); } catch (e) { return null; } }
  window.ResourcesSession = {
    current: function () { return cur(); },
    token: function () { var s = cur(); return s && s.token; },
    requireAccess: function (project) {
      var s = cur();
      if (s && s.access && s.access[project]) return Promise.resolve(s);
      return Promise.reject(new Error('No access to ' + project + ' in the test session'));
    },
    signOut: function () { try { localStorage.removeItem('resources:session'); } catch (e) {} }
  };
})();
