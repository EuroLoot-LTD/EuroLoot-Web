// Keep all requests on the network so that region and entitlement checks run on each use.
self.addEventListener('fetch',()=>{});
