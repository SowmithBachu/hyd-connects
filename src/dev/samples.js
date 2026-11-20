// DEVELOPMENT ONLY: made-up sample profiles for testing the city locally.
//
// Never shipped: app.js imports this file only when import.meta.env.DEV is true and
// the page is opened with ?demo (http://localhost:5173/?demo). Production builds
// drop the import entirely, so only people who have registered appear in the city.
const P = (id, name, role, company, area, status, bio, skills) => ({
  id, name, role, company, area, status, bio, skills, links: {}, sample: true,
});

export const SAMPLES = [
  P('s01', 'Ananya Reddy', 'Product Designer', 'Kettle & Kite Studio', 'hundred', 'open', 'Designs calm interfaces for messy logistics problems.', ['Figma', 'Design systems', 'Research']),
  P('s02', 'Rohan Varma', 'Founder', 'Lakeside Labs', 'cyber', 'hiring', 'Building developer tools for small data teams. Looking for a founding engineer.', ['Go', 'Postgres', 'DX']),
  P('s03', 'Sana Fatima', 'Frontend Engineer', 'Minar Works', 'cyber', 'open', 'React and motion. Cares about 60fps and accessible forms.', ['React', 'TypeScript', 'a11y']),
  P('s04', 'Karthik Nair', 'Staff Engineer', 'Boulder Cloud', 'metro', null, 'Distributed systems by day, trail runner by weekend.', ['Rust', 'Kubernetes']),
  P('s05', 'Meghana Rao', 'Design Lead', 'Pearl Pay', 'hundred', 'hiring', 'Growing a small fintech design team. Two product designer roles open.', ['Fintech', 'Leadership']),
  P('s06', 'Imran Qureshi', 'Backend Engineer', 'Chai Stack', 'ayyappa', 'open', 'Payments, queues and making on-call boring.', ['Java', 'Kafka', 'AWS']),
  P('s07', 'Divya Iyer', 'ML Engineer', 'Deccan Vision', 'metro', 'hiring', 'Computer vision for factories. Hiring ML and embedded engineers.', ['PyTorch', 'Edge ML']),
  P('s08', 'Aditya Sharma', 'Founder', 'Tank Bund Robotics', 'shilparamam', 'hiring', 'Warehouse robots that actually ship. Need a mechanical lead.', ['Robotics', 'ROS']),
  P('s09', 'Lakshmi Prasad', 'UX Researcher', 'Independent', 'lake', 'open', 'Field research across Telangana and Andhra. Telugu-first products.', ['Research', 'Service design']),
  P('s10', 'Vikram Goud', 'iOS Engineer', 'Nizam Notes', 'hundred', null, 'Indie apps, SwiftUI and tiny delightful details.', ['Swift', 'SwiftUI']),
  P('s11', 'Zoya Hussain', 'Brand Designer', 'Bidri Bureau', 'kavuri', 'open', 'Identity systems rooted in Deccani craft.', ['Branding', 'Type', 'Illustration']),
  P('s12', 'Nikhil Chowdary', 'DevOps Engineer', 'Granite Systems', 'cyber', 'open', 'Terraform, pipelines and saying no to snowflake servers.', ['Terraform', 'CI/CD', 'GCP']),
  P('s13', 'Priya Menon', 'Product Manager', 'Osmania Health', 'kavuri', 'hiring', 'Health records people can read. Hiring a senior full-stack engineer.', ['Healthtech', 'Strategy']),
  P('s14', 'Farhan Ali', 'Game Developer', 'Golconda Games', 'kavuri', null, 'Making a rhythm game about auto-rickshaws.', ['Unity', 'C#', 'Shaders']),
  P('s15', 'Sneha Kulkarni', 'Data Scientist', 'Monsoon Metrics', 'hundred', 'open', 'Forecasting, causal inference and honest dashboards.', ['Python', 'Stats', 'SQL']),
  P('s16', 'Arjun Yadav', 'Founder', 'Biryani Bytes', 'lake', 'hiring', 'Restaurant ops software. First design hire wanted.', ['SaaS', 'Sales']),
  P('s17', 'Tanvi Deshmukh', 'Motion Designer', 'Freelance', 'kavuri', 'open', 'Explainer films and product motion with a hand-drawn feel.', ['After Effects', 'Rive']),
  P('s18', 'Suresh Babu', 'Embedded Engineer', 'Cantonment Circuits', 'lake', null, 'Firmware for things that sit on poles in the rain.', ['C', 'RTOS', 'IoT']),
  P('s19', 'Ayesha Khan', 'Content Designer', 'Pearl Pay', 'hundred', null, 'Words inside products. English, Urdu and Telugu.', ['UX writing', 'Localization']),
  P('s20', 'Harsha Vardhan', 'Full-stack Engineer', 'Kettle & Kite Studio', 'ayyappa', 'open', 'Ships end to end. Likes small teams and clear specs.', ['Node', 'React', 'Postgres']),
  P('s21', 'Ritika Jain', 'Founder', 'Loom & Lathe', 'kavuri', 'hiring', 'Marketplace for handloom weavers. Looking for a growth engineer.', ['Marketplace', 'Ops']),
  P('s22', 'Mohammed Asif', 'Security Engineer', 'Boulder Cloud', 'metro', 'hiring', 'Building a product-security team from scratch.', ['AppSec', 'Threat modelling']),
  P('s23', 'Keerthi Suresh', 'Illustrator', 'Independent', 'kavuri', 'open', 'Draws Hyderabad one lane at a time.', ['Illustration', 'Editorial']),
  P('s24', 'Varun Teja', 'Android Engineer', 'Minar Works', 'ayyappa', 'open', 'Kotlin, Compose and offline-first apps.', ['Kotlin', 'Compose']),
  P('s25', 'Pooja Agarwal', 'Engineering Manager', 'Granite Systems', 'cyber', 'hiring', 'Platform team of eight, growing to twelve.', ['Leadership', 'Platform']),
  P('s26', 'Sai Kiran', 'Research Engineer', 'OU AI Lab', 'metro', null, 'Speech models for Indian languages.', ['Speech', 'NLP']),
  P('s27', 'Nazia Begum', 'Product Designer', 'Osmania Health', 'hundred', 'open', 'Makes clinical workflows less scary.', ['Healthcare UX', 'Prototyping']),
  P('s28', 'Abhinav Mishra', 'Founder', 'Runway Zero', 'hundred', 'hiring', 'Aviation logistics startup. Hiring backend and ops.', ['Logistics', 'APIs']),
  P('s29', 'Deepika Pillai', 'QA Engineer', 'Chai Stack', 'ayyappa', 'open', 'Test automation and a sharp eye for edge cases.', ['Playwright', 'API testing']),
  P('s30', 'Rahul Dev', 'Site Reliability Engineer', 'Deccan Vision', 'metro', null, 'Keeps the pagers quiet.', ['SRE', 'Observability']),
  P('s31', 'Shruti Hegde', 'Design Engineer', 'Lakeside Labs', 'cyber', null, 'Lives between Figma and the terminal.', ['CSS', 'WebGL', 'Prototyping']),
  P('s32', 'Yash Patel', 'Founder', 'Dosa Dynamics', 'shilparamam', 'hiring', 'AI copilots for chartered accountants. Hiring two engineers.', ['LLMs', 'B2B']),
  P('s33', 'Madhuri Kota', 'Technical Writer', 'Independent', 'kavuri', 'open', 'Docs developers actually finish reading.', ['Docs', 'API guides']),
  P('s34', 'Irfan Pasha', 'Data Engineer', 'Monsoon Metrics', 'kavuri', 'open', 'Pipelines, lakehouses and cost cuts.', ['Spark', 'dbt', 'Airflow']),
  P('s35', 'Bhavana Rao', 'Service Designer', 'Civic Deccan', 'kavuri', null, 'Designing public services with the people who use them.', ['Civic tech', 'Workshops']),
  P('s36', 'Tarun Gupta', 'Blockchain Engineer', 'Pearl Pay', 'hundred', 'open', 'Smart contracts, audits and healthy scepticism.', ['Solidity', 'Rust']),
  P('s37', 'Swathi Naidu', 'Founder', 'Tiffin Trail', 'shilparamam', 'hiring', 'Hyperlocal food delivery for students. Hiring a mobile dev.', ['Consumer', 'Growth']),
  P('s38', 'Joseph Mathew', 'Hardware Designer', 'Cantonment Circuits', 'lake', 'open', 'PCB layout and getting things through certification.', ['PCB', 'EMC']),
  P('s39', 'Anjali Singh', 'Growth Designer', 'Biryani Bytes', 'lake', null, 'Landing pages, experiments and honest copy.', ['Growth', 'Webflow']),
  P('s40', 'Pavan Kalyan Rao', 'Student Developer', 'KPHB Hack Club', 'ayyappa', 'open', 'Final-year student. Open source and hackathons.', ['Python', 'React']),
  P('s41', 'Fatima Zehra', 'AI Product Manager', 'Dosa Dynamics', 'shilparamam', null, 'Turns model capabilities into things people pay for.', ['AI products', 'Evals']),
  P('s42', 'Chaitanya Krishna', 'Cloud Architect', 'Granite Systems', 'ayyappa', 'open', 'Migrations without the drama.', ['Azure', 'Architecture']),
];
