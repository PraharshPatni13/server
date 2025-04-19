const APP_email = "weddingwhisper3@gmail.com";
const APP_email_pass_key = "yqhc ntzi ewdb etrn";

const fs = require('fs').promises; // Promisify fs module for async operations
const nodemailer = require('nodemailer');
const { write_log_file, error_message, info_message, success_message, normal_message } = require('./_all_help');
const path = require('path'); // Add path module import

async function send_email(to, subject, htmlContent) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: APP_email,
                pass: APP_email_pass_key,
            },
        });

        const mail_options = {
            from: APP_email,
            to: to,
            subject: subject,
            html: htmlContent,
        };

        const info = await transporter.sendMail(mail_options);
        info_message(`Email Info : ${info.response}`);
    } catch (error) {
        error_message('Error occurred:', error);
    }
}

async function send_welcome_page(email) {
    try {
        const welcome_page_html = await fs.readFile('modules/welcome_page_template.html', 'utf8');
        await send_email(email, 'Welcome to Travel Buddy!', welcome_page_html);
    } catch (error) {
        error_message('Failed to send welcome email:', error);
    }
}


async function send_otp_page(email, otp_to_send) {
    try {
        const otp_page_html = await fs.readFile('modules/otp_template.html', 'utf8');
        const email_html = otp_page_html.replace('{{OTP_CODE}}', otp_to_send);
        await send_email(email, 'Your OTP Code', email_html);
    } catch (error) {
        error_message('Failed to send OTP email:', error);
    }
}

async function send_forgot_password_email(email, new_password) {
    try {

        const reset_password_html = await fs.readFile('modules/forgot_password_admin.html', 'utf8');

        const email_html = reset_password_html.replace('{password}', new_password);

        await send_email(email, 'Your New Password', email_html);

    } catch (error) {
        console.error('Failed to send password reset email:', error);
    }
}

async function send_event_confirmation_email(email, event_name, event_date, event_time, event_description, event_location, organizer_name) {
    try {
        const event_confirmation_html = await fs.readFile('modules/event_confirmation.html', 'utf8');
        const email_html = event_confirmation_html.replace('{event_name}', event_name)
            .replace('{event_start}', event_date)
            .replace('{event_end}', event_time)
            .replace('{event_description}', event_description)
            .replace('{event_location}', event_location)
            .replace('{organizer_name}', organizer_name);


        await send_email(email, 'Event Confirmation', email_html);
    } catch (error) {
        error_message('Failed to send event confirmation email:', error);
    }
}

async function send_team_invitation_email(member_email, member_name, owner_name, business_name, member_role, invitationLink) {
    console.log("invitationLink", member_email, "  ", member_name, "  ", owner_name, "  ", business_name, "  ", member_role, "  ", invitationLink);
    try {
        // Load the invitation template
        let template;
        try {
            template = await fs.readFile('modules/invitation_template.html', 'utf8');
        } catch (error) {
            // If template file not found, use inline HTML as fallback
            template = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
                    <h2 style="color: #333;">You've been invited to join {{business_name}}</h2>
                    <p>Hi {{member_name}},</p>
                    <p>{{owner_name}} has invited you to join their team as a "{{member_role}}".</p>
                    <p>Click the button below to accept this invitation:</p>
                    <div style="text-align: center; margin: 25px 0;">
                        <a href="{{invitation_link}}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
                            Accept Invitation
                        </a>
                        <p>{{invitation_link}}</p>
                    </div>
                    <p style="color: #666; font-size: 14px;">If you did not expect this invitation, you can safely ignore this email.</p>
                </div>
            `;
            info_message('Invitation template not found, using fallback HTML');
        }

        // Replace placeholders in the template
        const htmlContent = template
            .replace(/{{business_name}}/g, business_name)
            .replace(/{{member_name}}/g, member_name)
            .replace(/{{owner_name}}/g, owner_name)
            .replace(/{{member_role}}/g, member_role)
            .replace(/{{invitation_link}}/g, invitationLink);

        await send_email(
            member_email,
            `Invitation to join ${business_name} as a team member`,
            htmlContent
        );

        return true;
    } catch (error) {
        error_message('Failed to send team invitation email:', error);
        return false;
    }
}

async function send_owner_notification_email(owner_email, owner_name, member_name, status) {
    console.log("Sending owner notification email:", owner_email, member_name, status);

    try {
        // Load the owner notification template
        let template;
        try {
            template = await fs.readFile(path.join(__dirname, 'send_owner_mail.html'), 'utf8');
        } catch (error) {
            // Fallback inline HTML
            template = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                    <h2>Team Invitation Update</h2>
                    <p>Hello {{owner_name}},</p>
                    <p>{{member_name}} has {{status_text}} your invitation to join the team.</p>
                    <p>Log in to your dashboard to view your current team.</p>
                    <p style="font-size: 12px; color: #999;">This is an automated notification from TeamConnect.</p>
                </div>
            `;
            console.log("Using fallback email template for owner notification.");
        }

        // Dynamic status text
        const statusText = status === "Confirmed" ? "accepted" : "declined";

        // Replace placeholders
        const htmlContent = template
            .replace(/{{owner_name}}/g, owner_name)
            .replace(/{{member_name}}/g, member_name)
            .replace(/{{status}}/g, status)
            .replace(/{{status_text}}/g, statusText);

        const subject = `Team invitation ${status.toLowerCase()} by ${member_name}`;

        // Send the email
        await send_email(owner_email, subject, htmlContent);
        return true;

    } catch (error) {
        console.error('Failed to send owner notification email:', error);
        return false;
    }
}

async function send_team_event_confirmation_email(member_email, member_name, event_id, event_title, event_start, event_end, event_location, owner_name, business_name) {
    try {
        // Load the event confirmation template from file
        let template;
        try {
            // Use the direct path to the HTML file
            template = await fs.readFile(path.join(__dirname, 'team_event_confirmation.html'), 'utf8');
        } catch (error) {
            error_message(`Error reading team event confirmation template: ${error.message}`);
            // Fallback inline HTML template
            template = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
                    <h2 style="color: #333;">Event Assignment Confirmation Needed</h2>
                    <p>Hello {{member_name}},</p>
                    
                    <p>You've been assigned to an event by {{owner_name}} from {{business_name}}:</p>
                    
                    <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 15px 0;">
                        <p><strong>Event:</strong> {{event_title}}</p>
                        <p><strong>Start:</strong> {{event_start}}</p>
                        <p><strong>End:</strong> {{event_end}}</p>
                        <p><strong>Location:</strong> {{event_location}}</p>
                    </div>
                    
                    <p>Please confirm if you are available for this event:</p>
                    
                    <div style="text-align: center; margin: 25px 0;">
                        <a href="{{accept_url}}" style="display: inline-block; padding: 10px 20px; background-color: #22C55E; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-right: 10px;">
                            Accept
                        </a>
                        <a href="{{reject_url}}" style="display: inline-block; padding: 10px 20px; background-color: #EF4444; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
                            Decline
                        </a>
                    </div>
                    
                    <p style="color: #666; font-size: 14px;">If you have any questions, please contact {{owner_name}} directly.</p>
                </div>
            `;
            info_message('Team event confirmation template not found, using fallback HTML');
        }

        // Convert dates to readable format
        const startDate = new Date(event_start).toLocaleString();
        const endDate = new Date(event_end).toLocaleString();

        // Create accept/reject URLs with the necessary parameters
        const baseUrl = process.env.SERVER_URL || "http://localhost:5000";
        const acceptUrl = `${baseUrl}/team_members/event-confirmation/${event_id}/${encodeURIComponent(member_email)}/accept`;
        const rejectUrl = `${baseUrl}/team_members/event-confirmation/${event_id}/${encodeURIComponent(member_email)}/reject`;

        // Replace placeholders in the template
        const htmlContent = template
            .replace(/{{member_name}}/g, member_name)
            .replace(/{{event_title}}/g, event_title)
            .replace(/{{event_start}}/g, startDate)
            .replace(/{{event_end}}/g, endDate)
            .replace(/{{event_location}}/g, event_location || "Not specified")
            .replace(/{{owner_name}}/g, owner_name)
            .replace(/{{business_name}}/g, business_name)
            .replace(/{{accept_url}}/g, acceptUrl)
            .replace(/{{reject_url}}/g, rejectUrl);

        await send_email(
            member_email,
            `Event Assignment: ${event_title}`,
            htmlContent
        );

        return true;
    } catch (error) {
        error_message('Failed to send team event confirmation email:', error);
        return false;
    }
}

module.exports = {
    send_welcome_page,
    send_otp_page,
    send_forgot_password_email,
    send_event_confirmation_email,
    send_team_invitation_email,
    send_owner_notification_email,
    send_team_event_confirmation_email
};
